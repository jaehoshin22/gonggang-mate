"""에브리타임 시간표 캡처 인식 (F1).

딥러닝이나 OCR 없이 정해진 규칙으로 픽셀을 읽는다. 그래서 같은 캡처는 항상 같은 결과가 나온다.

처리 흐름 (계획서 05 - 1~3단계)
1. 연한 회색 픽셀(격자선)이 가로로 길게 이어진 줄을 찾고, 간격이 일정한 줄들을
   '1시간 눈금'으로 본다. 맨 위 눈금 = 09:00 (에브리타임 기본 시작 시각).
2. 그 범위 안에서 세로 격자선을 찾아 요일 열(월~금, 토·일)을 정한다.
3. 열 가운데 띠를 위에서 아래로 읽어 채도가 있는(색칠된) 구간을 수업으로 보고,
   픽셀 위치를 시각으로 바꾼다. 색이 바뀌는 곳은 다른 수업으로 나눈다.
4. 시각은 5분 단위로 맞추고, 길이가 학교 수업 단위(75·150·180분)에 가까우면 그 값으로 맞춘다.

실제 캡처에 맞춰 조정할 값은 아래 상수에 모아 두었다.
이미지는 메모리(BytesIO)에서만 다루고 디스크에 저장하지 않는다.
"""

from io import BytesIO
from statistics import median

from PIL import Image, ImageChops, UnidentifiedImageError

from .timeutil import DAYS, to_hhmm

# ---- 조정 가능한 상수 -------------------------------------------------------
START_HOUR = 9               # 맨 위 눈금의 시각
SNAP_MINUTES = 5             # 시각 반올림 단위
CLASS_UNITS = (75, 150, 180) # 수업 길이 단위(분): 1시간 15분, 연강, 3시간
UNIT_TOLERANCE = 10          # 이 정도 차이면 수업 단위로 맞춘다(분)

GRAY_MAX_SAT = 30            # 격자선: 채도 낮음 (0~255)
GRAY_MIN_VAL = 175           #         밝기 범위
GRAY_MAX_VAL = 246
BLOCK_MIN_SAT = 45           # 수업 블록: 채도가 이 이상
BLOCK_MIN_VAL = 90

LINE_MAX_THICKNESS = 6       # 이보다 두꺼우면 선이 아니라 면
H_LINE_MIN_RATIO = 0.25      # 가로선: 폭의 25% 이상이 회색
V_LINE_MIN_RATIO = 0.40      # 세로선: 격자 높이의 40% 이상이 회색
SPACING_TOLERANCE = 0.06     # 눈금 간격 허용 오차
STRIP_MARGIN = 0.08          # 열 양옆 8%는 읽지 않음 (테두리)
BLOCK_ROW_RATIO = 0.15       # 띠 폭의 15% 이상이 색이면 수업 줄 (흰 글자 줄도 통과)
GAP_FILL_HOURS = 0.08        # 이 이하 틈은 같은 블록 (글자 사이 등, 약 5분)
MIN_BLOCK_HOURS = 0.15       # 이보다 짧은 색 구간은 무시 (약 9분)
HUE_SPLIT = 14               # 색상 차이가 이 이상이면 다른 수업
DARK_MEAN_VAL = 90           # 평균 밝기가 이보다 낮으면 다크모드로 판단
END_HOUR_EXPECTED = 18       # 공강 계산 범위 끝. 격자가 이보다 일찍 끝나면 경고


class ParseError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


# ---- 마스크와 투영 ---------------------------------------------------------

def _band_mask(band, lo, hi):
    """lo <= 값 <= hi 이면 255, 아니면 0 인 L 이미지."""
    return band.point(lambda p: 255 if lo <= p <= hi else 0)


def _row_counts(mask):
    w, h = mask.size
    data = mask.tobytes()
    return [data[y * w:(y + 1) * w].count(255) for y in range(h)]


def _col_counts(mask):
    transpose = getattr(Image, "Transpose", Image).TRANSPOSE
    return _row_counts(mask.transpose(transpose))


def _find_lines(counts, length, min_ratio):
    """얇은 선(LINE_MAX_THICKNESS 이하)의 중심 위치 목록."""
    limit = length * min_ratio
    lines, start = [], None
    for i, c in enumerate(counts + [0]):
        if c >= limit and start is None:
            start = i
        elif c < limit and start is not None:
            if i - start <= LINE_MAX_THICKNESS:
                lines.append((start + i - 1) / 2)
            start = None
    return lines


def _regular_run(lines, min_gap):
    """간격이 일정한 가장 긴 선 묶음. 가려진 선 하나는 건너뛴다."""
    best, best_real = [], 0
    for i in range(len(lines) - 1):
        step = lines[i + 1] - lines[i]
        if step < min_gap:
            continue
        tol = max(2.0, step * SPACING_TOLERANCE)
        chain = [lines[i], lines[i + 1]]
        real = 2
        while True:
            found = None
            # 간격이 확실해진 뒤(실제 선 3개 이상)에만 가려진 눈금 하나를 건너뛴다
            for skip in ((1, 2) if real >= 3 else (1,)):
                target = chain[-1] + step * skip
                near = [x for x in lines if abs(x - target) <= tol * skip]
                if near:
                    found = (skip, min(near, key=lambda x: abs(x - target)))
                    break
            if not found:
                break
            skip, pos = found
            if skip == 2:
                chain.append(chain[-1] + step)  # 가려진 눈금 보충
            chain.append(pos)
            real += 1
            step = (chain[-1] - chain[0]) / (len(chain) - 1)
        if real > best_real:
            best, best_real = chain, real
    return best


# ---- 블록 읽기 -------------------------------------------------------------

def _hue_diff(a, b):
    d = abs(a - b) % 256
    return min(d, 256 - d)


def _row_hues(hue_strip, mask_strip):
    """줄마다 색칠된 픽셀의 대표 색상(없으면 None)."""
    w, h = mask_strip.size
    hues, masks = hue_strip.tobytes(), mask_strip.tobytes()
    out = []
    for y in range(h):
        row = [hues[y * w + x] for x in range(0, w, 3) if masks[y * w + x]]
        out.append(median(row) if row else None)
    return out


def _segments(is_block, hues, px_per_hour):
    """색칠된 줄들을 [시작, 끝) 구간으로 묶고, 색이 바뀌면 나눈다."""
    fill = max(1, round(px_per_hour * GAP_FILL_HOURS))
    min_len = px_per_hour * MIN_BLOCK_HOURS
    rows = list(is_block)
    # 짧은 틈(블록 안 글자 등) 메우기
    i = 0
    while i < len(rows):
        if not rows[i]:
            j = i
            while j < len(rows) and not rows[j]:
                j += 1
            if 0 < i and j < len(rows) and j - i <= fill:
                for k in range(i, j):
                    rows[k] = True
            i = j
        else:
            i += 1

    segs, start = [], None
    for y, flag in enumerate(rows + [False]):
        if flag and start is None:
            start = y
        elif not flag and start is not None:
            segs.append((start, y))
            start = None

    # 색이 바뀌는 곳에서 나누기 (붙어 있는 서로 다른 수업)
    result = []
    for a, b in segs:
        cut_from = a
        ref = None
        y = a
        while y < b:
            hue = hues[y]
            if hue is None:
                y += 1
                continue
            if ref is None:
                ref = hue
            elif _hue_diff(hue, ref) > HUE_SPLIT:
                window = [h for h in hues[y:y + 4] if h is not None]
                if len(window) >= 3 and all(_hue_diff(h, ref) > HUE_SPLIT for h in window):
                    result.append((cut_from, y))
                    cut_from, ref = y, hue
            y += 1
        result.append((cut_from, b))
    return [(a, b) for a, b in result if b - a >= min_len]


def _snap(minutes):
    return int(round(minutes / SNAP_MINUTES) * SNAP_MINUTES)


def _to_class(day, top_px, bottom_px, px_per_hour, color):
    start = _snap(START_HOUR * 60 + top_px / px_per_hour * 60)
    end = _snap(START_HOUR * 60 + bottom_px / px_per_hour * 60)
    for unit in CLASS_UNITS:
        if abs((end - start) - unit) <= UNIT_TOLERANCE:
            end = start + unit
            break
    return {"day": day, "start": to_hhmm(start), "end": to_hhmm(end), "color": color}


# ---- 진입점 ----------------------------------------------------------------

def _open(data):
    if not data:
        raise ParseError("empty", "이미지가 비어 있습니다.")
    try:
        img = Image.open(BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError):
        raise ParseError("not_image", "이미지 파일이 아닙니다. 시간표 캡처(PNG, JPG)를 올려 주세요.")
    return img.convert("RGB")


def parse_timetable(data):
    """이미지 바이트 -> {"classes": [...], "warnings": [...], "meta": {...}}"""
    rgb = _open(data)
    width, height = rgb.size
    hue, sat, val = rgb.convert("HSV").split()

    if sum(val.resize((64, 64)).tobytes()) / 4096 < DARK_MEAN_VAL:
        raise ParseError("dark_mode", "다크모드 캡처는 아직 지원하지 않습니다. 라이트모드로 캡처해 주세요.")

    gray = ImageChops.darker(
        _band_mask(sat, 0, GRAY_MAX_SAT), _band_mask(val, GRAY_MIN_VAL, GRAY_MAX_VAL)
    )
    colored = ImageChops.darker(
        _band_mask(sat, BLOCK_MIN_SAT, 255), _band_mask(val, BLOCK_MIN_VAL, 255)
    )

    # 1. 가로 눈금
    h_lines = _find_lines(_row_counts(gray), width, H_LINE_MIN_RATIO)
    hours = _regular_run(h_lines, min_gap=max(20, height / 60))
    if len(hours) < 3:
        raise ParseError("not_timetable", "시간표 격자를 찾지 못했습니다. 에브리타임 시간표 화면을 캡처해 주세요.")
    grid_top, grid_bottom = round(hours[0]), round(hours[-1])
    px_per_hour = (hours[-1] - hours[0]) / (len(hours) - 1)
    grid_h = grid_bottom - grid_top

    # 2. 세로 격자선 -> 요일 열
    band = gray.crop((0, grid_top, width, grid_bottom))
    v_lines = _find_lines(_col_counts(band), grid_h, V_LINE_MIN_RATIO)
    bounds = [0.0] + v_lines + [float(width - 1)]
    intervals = [(bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1)]
    widest = max(b - a for a, b in intervals)
    wide = [(b - a) >= widest * 0.75 for a, b in intervals]
    groups, cur = [], []
    for iv, ok in zip(intervals, wide):
        if ok:
            cur.append(iv)
        else:
            if cur:
                groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    columns = max(groups, key=len) if groups else []
    if not 3 <= len(columns) <= 7:
        raise ParseError("not_timetable", "요일 칸을 찾지 못했습니다. 에브리타임 시간표 화면을 캡처해 주세요.")

    warnings = []
    if len(columns) < 5:
        warnings.append({
            "code": "few_days",
            "message": f"요일 칸이 {len(columns)}개만 보입니다. 화면 옆이 잘리지 않았는지 확인해 주세요.",
        })

    # 3. 열마다 색칠된 구간 읽기
    end_hour = START_HOUR + len(hours) - 1
    classes = []
    for idx, (x0, x1) in enumerate(columns):
        margin = (x1 - x0) * STRIP_MARGIN
        box = (round(x0 + margin), grid_top, round(x1 - margin), grid_bottom)
        mask_strip = colored.crop(box)
        strip_w = box[2] - box[0]
        counts = _row_counts(mask_strip)
        is_block = [c >= strip_w * BLOCK_ROW_RATIO for c in counts]
        hues = _row_hues(hue.crop(box), mask_strip)
        for a, b in _segments(is_block, hues, px_per_hour):
            mid_y = grid_top + (a + b) // 2
            color = "#c8c8c8"
            for x in range(box[2] - 1, box[0], -1):  # 글자는 왼쪽 정렬이라 오른쪽부터 찾음
                if colored.getpixel((x, mid_y)):
                    color = "#%02x%02x%02x" % rgb.getpixel((x, mid_y))
                    break
            item = _to_class(DAYS[idx], a, b, px_per_hour, color)
            # 격자가 18시 전에 끝났는데 블록이 바닥에 닿아 있으면 가려진 것으로 본다
            if b >= grid_h - 2 and end_hour < END_HOUR_EXPECTED:
                warnings.append({
                    "code": "block_cut",
                    "message": f"{item['start']}에 시작하는 수업이 격자 끝에서 잘렸습니다. 종료 시각을 확인해 주세요.",
                })
            classes.append(item)

    if end_hour < END_HOUR_EXPECTED:
        warnings.append({
            "code": "grid_ends_early",
            "message": f"시간표가 {end_hour}시에서 끝납니다. 아래가 가려졌다면 {end_hour}시 이후 수업을 직접 추가해 주세요.",
        })

    return {
        "classes": classes,
        "warnings": warnings,
        "meta": {
            "days": DAYS[:len(columns)],
            "grid_start": to_hhmm(START_HOUR * 60),
            "grid_end": to_hhmm(end_hour * 60),
            "px_per_hour": round(px_per_hour, 1),
            "size": [width, height],
        },
    }
