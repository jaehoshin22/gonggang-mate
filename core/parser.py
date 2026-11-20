"""에브리타임 시간표 캡처 인식 (F1).

딥러닝이나 OCR 없이 정해진 규칙으로 픽셀을 읽는다. 그래서 같은 캡처는 항상 같은 결과가 나온다.

처리 흐름 (계획서 05 - 1~3단계)
0. 평균 밝기로 라이트/다크모드를 판단하고, 테마에 맞는 격자선 밝기 범위를 쓴다.
1. 회색 픽셀(격자선)이 가로로 이어진 줄을 찾고, 간격이 일정한 줄들을 '1시간 눈금'으로 본다.
   빽빽한 시간표는 블록이 눈금을 덮으므로, 가려진 눈금은 간격으로 채워 넣는다.
   맨 위 눈금 = 09:00 (에브리타임 기본 시작 시각).
2. 시간 라벨 칸 세로선이 이어지는 구간까지만 격자로 보고, 아래 카드 등은 잘라낸다.
3. 세로 격자선으로 요일 열(월~금, 토·일)을 정한다. 가려져 합쳐진 칸은 칸 폭으로 나눈다.
4. 열 가운데 띠를 위에서 아래로 읽어 채도가 있는(색칠된) 구간을 수업으로 보고,
   픽셀 위치를 시각으로 바꾼다. 색이 바뀌는 곳은 다른 수업으로 나눈다.
5. 시각은 5분 단위로만 반올림한다. 수업 길이는 보정하지 않는다
   (50분·1시간 15분·2시간 50분 수업과 근로·알바·운동 같은 개인 일정이 섞여 있음).

실제 캡처에 맞춰 조정할 값은 아래 상수에 모아 두었다.
이미지는 메모리(BytesIO)에서만 다루고 디스크에 저장하지 않는다.
"""

from io import BytesIO
from statistics import median

from PIL import Image, ImageChops, UnidentifiedImageError

from .timeutil import DAYS, to_hhmm

# ---- 조정 가능한 상수 -------------------------------------------------------
START_HOUR = 9               # 맨 위 눈금의 시각
SNAP_MINUTES = 5             # 시각 반올림 단위. 수업 길이는 따로 보정하지 않는다
                             # (50분·1시간 15분·2시간 50분 수업과 근로·알바 같은 개인 일정이 섞여 있음)

GRAY_MAX_SAT = 30            # 격자선: 채도 낮음 (0~255)
GRAY_VAL_RANGE = {           # 격자선 밝기 범위 (테마별)
    "light": (175, 246),     # 흰 배경(255)보다 어둡고 글자보다 밝은 회색
    "dark": (24, 90),        # 검은 배경(약 17)보다 밝은 회색 (실측 29~50)
}
BLOCK_MIN_SAT = 45           # 수업 블록: 채도가 이 이상
BLOCK_MIN_VAL = 90

LINE_MAX_THICKNESS = 6       # 이보다 두꺼우면 선이 아니라 면
H_LINE_MIN_RATIO = 0.15      # 가로선: 폭의 15% 이상이 회색 (빽빽한 시간표는 블록이 선을 덮음)
MAX_HIDDEN_LINES = 4         # 블록에 완전히 가려져도 이어 붙일 수 있는 연속 눈금 수
V_LINE_MIN_RATIO = 0.10      # 세로선: 격자 높이의 10% 이상이 회색 (빽빽하면 블록이 선을 덮음)
SPACING_TOLERANCE = 0.06     # 눈금 간격 허용 오차
STRIP_MARGIN = 0.08          # 열 양옆 8%는 읽지 않음 (테두리)
BLOCK_ROW_RATIO = 0.15       # 띠 폭의 15% 이상이 색이면 수업 줄 (흰 글자 줄도 통과)
GAP_FILL_HOURS = 0.08        # 이 이하 틈은 같은 블록 (글자 사이 등, 약 5분)
MIN_BLOCK_HOURS = 0.15       # 이보다 짧은 색 구간은 무시 (약 9분)
BLOCK_TOP_INSET_HOURS = 0.03 # 블록 윗변이 시각 선보다 아래로 들어간 정도 (실측 2~3px / 1시간 74px)
HUE_SPLIT = 14               # 색상 차이가 이 이상이면 다른 수업
DARK_MEAN_VAL = 90           # 평균 밝기가 이보다 낮으면 다크모드
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


def _follow(lines, start, step, tol, direction):
    """start 에서 step 간격으로 한 방향으로 따라가며 실제 선을 모은다.
    수업 블록에 가려진 눈금은 MAX_HIDDEN_LINES 개까지 건너뛴다. [(위치, 건너뛴 칸 수)]"""
    found, pos = [], start
    while True:
        hit = None
        for k in range(1, MAX_HIDDEN_LINES + 2):
            target = pos + direction * step * k
            limit = tol + 1.5 * (k - 1)
            near = [x for x in lines if abs(x - target) <= limit]
            if near:
                hit = (min(near, key=lambda x: abs(x - target)), k)
                break
        if hit is None:
            return found
        found.append(hit)
        pos = hit[0]


def _regular_run(lines, min_gap):
    """간격이 일정한 가장 긴 눈금 묶음 -> 1시간 눈금 위치 목록(가려진 눈금은 채워 넣음).

    빽빽한 시간표는 블록이 가로선을 덮어 일부 눈금만 보이므로, 이웃한 두 선의 간격을
    1시간 후보로 잡고 그 배수 위치에 있는 선들을 앞뒤로 모은다.
    """
    best, best_count = [], 0
    for i in range(len(lines) - 1):
        step = lines[i + 1] - lines[i]
        if step < min_gap:
            continue
        tol = max(2.0, step * SPACING_TOLERANCE)
        ahead = _follow(lines, lines[i + 1], step, tol, 1)
        behind = _follow(lines, lines[i], step, tol, -1)
        # 1시간 후보가 진짜 간격의 절반 같은 약수가 아닌지: 바로 이웃한 눈금 쌍이 하나 더 있어야 함
        if sum(1 for _, k in ahead + behind if k == 1) < 1:
            continue
        real = sorted([lines[i], lines[i + 1]] + [p for p, _ in ahead + behind])
        if len(real) > best_count:
            best, best_count = real, len(real)
    if len(best) < 2:
        return []
    first, last = best[0], best[-1]
    approx = min(b - a for a, b in zip(best, best[1:]))  # 이웃한 눈금 쌍이 있으므로 = 1시간
    n = max(1, round((last - first) / approx))
    step = (last - first) / n
    return [first + step * j for j in range(n + 1)]


def _day_columns(v_lines, width):
    """세로선 위치 -> 폭이 같은 요일 칸 목록 [(x0, x1)].

    빽빽한 시간표는 블록이 세로선을 덮어 두 칸이 하나로 보일 수 있으므로,
    칸 폭(w)의 정수배인 구간은 k칸으로 나눈다.
    """
    bounds = [0.0] + v_lines + [float(width - 1)]
    intervals = [(a, b) for a, b in zip(bounds, bounds[1:])]
    candidates = sorted({round(b - a) for a, b in intervals if b - a >= width * 0.08})

    def build(w):
        split = []
        for a, b in intervals:
            k = round((b - a) / w)
            # 한 칸은 테두리 때문에 조금 좁을 수 있어 12%, 합쳐진 여러 칸은 칸마다 6%까지 허용
            limit = w * 0.12 if k == 1 else w * 0.06 * k
            if k >= 1 and abs((b - a) - k * w) <= limit:
                step = (b - a) / k
                split += [(a + step * j, a + step * (j + 1)) for j in range(k)]
            else:
                split.append(None)  # 라벨 칸·테두리 등 요일 칸이 아닌 구간
        groups, cur = [], []
        for iv in split + [None]:
            if iv is None:
                if cur:
                    groups.append(cur)
                cur = []
            else:
                cur.append(iv)
        return max(groups, key=len) if groups else []

    # 칸 폭 후보마다 만들어 보고, 7칸 이하에서 가장 많은 칸이 이어지는 폭을 고른다
    best = []
    for w in candidates:
        cols = build(w)
        if len(cols) <= 7 and len(cols) >= len(best):
            best = cols
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
                    result.append((cut_from, y, True))  # 끝 = 다음 블록의 시작 위치
                    cut_from, ref = y, hue
            y += 1
        result.append((cut_from, b, False))
    return [(a, b, cut) for a, b, cut in result if b - a >= min_len]


def _snap(minutes):
    return int(round(minutes / SNAP_MINUTES) * SNAP_MINUTES)


def _to_class(day, top_px, bottom_px, px_per_hour, color, cut_end=False):
    # 블록은 시작 시각 선보다 2~3px 아래에서 그려지므로 그만큼 빼고 계산한다
    inset = px_per_hour * BLOCK_TOP_INSET_HOURS
    start = _snap(START_HOUR * 60 + (top_px - inset) / px_per_hour * 60)
    end_px = bottom_px - inset if cut_end else bottom_px
    end = _snap(START_HOUR * 60 + end_px / px_per_hour * 60)
    return {"day": day, "start": to_hhmm(start), "end": to_hhmm(end), "color": color}


# ---- 진입점 ----------------------------------------------------------------

def _open(data):
    if not data:
        raise ParseError("empty", "이미지가 비어 있어요.")
    try:
        img = Image.open(BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError):
        raise ParseError("not_image", "이미지 파일이 아니에요.")
    return img.convert("RGB")


def parse_timetable(data):
    """이미지 바이트 -> {"classes": [...], "warnings": [...], "meta": {...}}"""
    rgb = _open(data)
    width, height = rgb.size
    hue, sat, val = rgb.convert("HSV").split()

    theme = "dark" if sum(val.resize((64, 64)).tobytes()) / 4096 < DARK_MEAN_VAL else "light"
    gray = ImageChops.darker(
        _band_mask(sat, 0, GRAY_MAX_SAT), _band_mask(val, *GRAY_VAL_RANGE[theme])
    )
    colored = ImageChops.darker(
        _band_mask(sat, BLOCK_MIN_SAT, 255), _band_mask(val, BLOCK_MIN_VAL, 255)
    )

    # 1. 가로 눈금
    h_lines = _find_lines(_row_counts(gray), width, H_LINE_MIN_RATIO)
    hours = _regular_run(h_lines, min_gap=max(20, height / 60))
    if len(hours) < 3:
        raise ParseError("not_timetable", "시간표를 찾지 못했어요.")
    px_per_hour = (hours[-1] - hours[0]) / (len(hours) - 1)

    # 2. 격자 밖(아래 카드 테두리 등)에서 우연히 간격이 맞은 눈금 잘라내기.
    #    왼쪽 테두리·시간 라벨 칸 세로선은 블록에 가려지지 않으므로, 이 선이 있는 시간대만 격자로 본다.
    left = gray.crop((0, round(hours[0]), width // 5, round(hours[-1])))
    left_counts = _col_counts(left)
    # 바깥 테두리는 아래 카드와 이어질 수 있어, 가장 오른쪽의 긴 세로선(시간 라벨 칸 경계)을 쓴다
    top_count = max(left_counts)
    x_ref = max(x for x, c in enumerate(left_counts) if c >= top_count * 0.9)

    def has_frame(y0, y1):
        rows = range(round(y0) + 2, round(y1) - 2)
        hit = sum(
            1 for y in rows
            if any(gray.getpixel((x, y)) for x in range(max(0, x_ref - 2), min(width, x_ref + 3)))
        )
        return hit >= len(rows) * 0.6

    # 위에서부터 세로선이 이어지는 구간만 남긴다 (중간에 끊기면 그 아래는 격자가 아님)
    i = 0
    while i < len(hours) - 1 and not has_frame(hours[i], hours[i + 1]):
        i += 1
    j = i
    while j < len(hours) - 1 and has_frame(hours[j], hours[j + 1]):
        j += 1
    hours = hours[i:j + 1]
    if len(hours) < 3:
        raise ParseError("not_timetable", "시간표를 찾지 못했어요.")
    grid_top, grid_bottom = round(hours[0]), round(hours[-1])
    grid_h = grid_bottom - grid_top

    # 3. 세로 격자선 -> 요일 열
    band = gray.crop((0, grid_top, width, grid_bottom))
    v_lines = _find_lines(_col_counts(band), grid_h, V_LINE_MIN_RATIO)
    columns = _day_columns(v_lines, width)
    if not 3 <= len(columns) <= 7:
        raise ParseError("not_timetable", "요일 칸을 찾지 못했어요.")

    warnings = []
    if len(columns) < 5:
        warnings.append({
            "code": "few_days",
            "message": f"요일이 {len(columns)}개만 보여요. 화면 옆이 잘리지 않았는지 확인해 주세요.",
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
        for a, b, cut_end in _segments(is_block, hues, px_per_hour):
            mid_y = grid_top + (a + b) // 2
            color = "#c8c8c8"
            for x in range(box[2] - 1, box[0], -1):  # 글자는 왼쪽 정렬이라 오른쪽부터 찾음
                if colored.getpixel((x, mid_y)):
                    color = "#%02x%02x%02x" % rgb.getpixel((x, mid_y))
                    break
            item = _to_class(DAYS[idx], a, b, px_per_hour, color, cut_end)
            # 격자가 18시 전에 끝났는데 블록이 바닥에 닿아 있으면 가려진 것으로 본다
            if b >= grid_h - 2 and end_hour < END_HOUR_EXPECTED:
                warnings.append({
                    "code": "block_cut",
                    "message": f"{item['start']}에 시작하는 수업이 화면 끝에서 잘렸어요. 끝나는 시각을 확인해 주세요.",
                })
            classes.append(item)

    if end_hour < END_HOUR_EXPECTED:
        warnings.append({
            "code": "grid_ends_early",
            "message": f"시간표가 {end_hour}시까지만 보여요. 그 뒤 수업은 직접 추가해 주세요.",
        })

    return {
        "classes": classes,
        "warnings": warnings,
        "meta": {
            "theme": theme,
            "days": DAYS[:len(columns)],
            "grid_start": to_hhmm(START_HOUR * 60),
            "grid_end": to_hhmm(end_hour * 60),
            "px_per_hour": round(px_per_hour, 1),
            "size": [width, height],
        },
    }
