"""에브리타임 시간표와 비슷한 합성 캡처를 만든다 (인식 로직 테스트용).

실제 캡처와 완전히 같지는 않으므로, 실제 캡처 10장은 tools/evaluate.py 로 따로 검증한다.
"""

from io import BytesIO

from PIL import Image, ImageDraw

PASTELS = [
    (242, 140, 140), (130, 180, 240), (140, 205, 160), (245, 190, 110),
    (180, 150, 225), (110, 200, 200), (240, 160, 200), (200, 190, 120),
]
THEMES = {
    # 배경, 격자선, 일반 글자, 하단 탭바
    "light": {"bg": (255, 255, 255), "grid": (226, 226, 226), "text": (60, 60, 60), "bar": (247, 247, 247)},
    "dark": {"bg": (17, 17, 17), "grid": (45, 45, 45), "text": (200, 200, 200), "bar": (28, 28, 28)},
}


def _to_min(t):
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def make_timetable(
    classes,
    days=5,
    start_hour=9,
    end_hour=18,
    width=1080,
    hour_px=110,
    top=260,
    header_h=56,
    label_w=56,
    overlay_from_hour=None,
    fmt="PNG",
    dark=False,
):
    """classes: [(day_index, "10:30", "11:45"), ...] 또는 (day, start, end, color_index)."""
    grid_top = top + header_h
    grid_bottom = grid_top + (end_hour - start_hour) * hour_px
    height = grid_bottom + 240
    t = THEMES["dark" if dark else "light"]
    GRID, TEXT = t["grid"], t["text"]
    img = Image.new("RGB", (width, height), t["bg"])
    d = ImageDraw.Draw(img)

    # 상태바·앱 헤더 흉내
    d.rectangle([40, 70, 380, 110], fill=TEXT)
    d.rectangle([40, 130, 200, 160], fill=(150, 150, 150))
    d.ellipse([width - 120, 80, width - 70, 130], outline=TEXT, width=4)

    col_w = (width - label_w) / days
    # 요일 헤더 글자
    for i in range(days):
        cx = label_w + col_w * i + col_w / 2
        d.rectangle([cx - 12, top + 18, cx + 12, top + 40], fill=TEXT)
    # 시간 라벨 숫자
    for h in range(end_hour - start_hour):
        y = grid_top + h * hour_px
        d.rectangle([14, y + 8, 40, y + 30], fill=TEXT)

    # 격자
    for h in range(end_hour - start_hour + 1):
        y = grid_top + h * hour_px
        d.line([0, y, width, y], fill=GRID, width=2)
    d.line([0, top, width, top], fill=GRID, width=2)  # 헤더 위 선
    for i in range(days + 1):
        x = round(label_w + col_w * i)
        d.line([x, top, x, grid_bottom], fill=GRID, width=2)

    # 수업 블록 (격자 위에 그림)
    for n, item in enumerate(classes):
        day, start, end = item[:3]
        color = PASTELS[item[3] if len(item) > 3 else n % len(PASTELS)]
        if dark:  # 다크모드 블록은 조금 진한 색
            color = tuple(round(c * 0.85) for c in color)
        y0 = grid_top + (_to_min(start) - start_hour * 60) / 60 * hour_px
        y1 = grid_top + (_to_min(end) - start_hour * 60) / 60 * hour_px
        # 실제 에브리타임처럼 블록은 세로선 안쪽, 시각 선보다 2px 아래에서 시작
        x0 = round(label_w + col_w * day) + 2
        x1 = round(label_w + col_w * (day + 1)) - 2
        d.rectangle([x0, round(y0) + 2, x1, round(y1) - 1], fill=color)
        # 블록 안 흰 글자 (과목명 두 줄 + 강의실). 글자 하나 = 획 굵기 3px 사각형
        for k, w in enumerate((0.85, 0.6, 0.4)):
            ty = round(y0) + 8 + k * 30
            if ty + 22 >= y1:
                break
            cx = x0 + 6
            while cx + 22 <= x0 + 6 + (x1 - x0) * w:
                d.rectangle([cx, ty, cx + 22, ty + 22], outline=(255, 255, 255), width=3)
                d.line([cx + 11, ty, cx + 11, ty + 22], fill=(255, 255, 255), width=3)
                cx += 27

    # 하단 탭바
    d.rectangle([0, height - 150, width, height], fill=t["bar"])
    for i in range(5):
        cx = width / 5 * i + width / 10
        d.rectangle([cx - 25, height - 115, cx + 25, height - 65], fill=(170, 170, 170))

    # 친구 목록 같은 오버레이가 아래를 가림
    if overlay_from_hour is not None:
        oy = grid_top + (overlay_from_hour - start_hour) * hour_px + hour_px // 3
        d.rectangle([0, oy, width, height], fill=t["bg"])
        d.rectangle([0, oy, width, oy + 6], fill=(200, 200, 200))
        for k in range(4):
            y = oy + 40 + k * 90
            d.ellipse([40, y, 100, y + 60], fill=(190, 190, 190))
            d.rectangle([130, y + 15, 500, y + 45], fill=TEXT)

    buf = BytesIO()
    img.save(buf, fmt, **({"quality": 90} if fmt == "JPEG" else {}))
    return buf.getvalue()
