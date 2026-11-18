import time
from io import BytesIO

import pytest
from PIL import Image

from core.parser import ParseError, parse_timetable
from core.timeutil import DAYS, to_minutes
from tests.synth import make_timetable

SAMPLE = [
    (0, "09:00", "10:15"), (0, "10:30", "11:45"),   # 1시간 15분 연속 (쉬는 시간 15분)
    (1, "12:00", "15:00"),                           # 3시간
    (2, "10:30", "12:00", 0), (2, "12:00", "13:15", 1),  # 색이 다른 수업이 붙어 있음
    (3, "13:30", "16:00"),                           # 연강 150분
    (4, "15:00", "16:15"),
]


def as_set(classes):
    return {(c["day"], c["start"], c["end"]) for c in classes}


def expected(classes):
    return {(DAYS[c[0]], c[1], c[2]) for c in classes}


def assert_close(found, want, tol=5):
    """요일이 같고 시작·종료 오차가 tol 분 이내인 짝이 모두 있어야 한다."""
    assert len(found) == len(want), (found, want)
    for day, s, e in want:
        assert any(
            d == day and abs(to_minutes(fs) - to_minutes(s)) <= tol
            and abs(to_minutes(fe) - to_minutes(e)) <= tol
            for d, fs, fe in found
        ), (day, s, e, found)


def test_recognizes_all_blocks_exactly():
    result = parse_timetable(make_timetable(SAMPLE))
    assert as_set(result["classes"]) == expected(SAMPLE)
    assert result["warnings"] == []
    assert result["meta"]["days"] == DAYS[:5]


@pytest.mark.parametrize("kw", [
    {"width": 750, "hour_px": 76},     # 작은 화면
    {"width": 1290, "hour_px": 132},   # 큰 화면
    {"fmt": "JPEG"},                   # 압축 노이즈
    {"top": 400, "header_h": 70},      # 헤더 위치가 다름
])
def test_recognizes_on_different_screens(kw):
    result = parse_timetable(make_timetable(SAMPLE, **kw))
    assert_close(as_set(result["classes"]), expected(SAMPLE))


def test_saturday_column():
    classes = [(0, "09:00", "10:15"), (5, "10:00", "13:00")]
    result = parse_timetable(make_timetable(classes, days=6))
    assert result["meta"]["days"] == DAYS[:6]
    assert as_set(result["classes"]) == expected(classes)


def test_empty_timetable():
    result = parse_timetable(make_timetable([]))
    assert result["classes"] == []


def test_evening_grid_extends_past_18():
    classes = [(1, "18:00", "21:00")]
    result = parse_timetable(make_timetable(classes, end_hour=22))
    assert as_set(result["classes"]) == expected(classes)
    assert result["meta"]["grid_end"] == "22:00"


def test_cropped_bottom_warns_without_crashing():
    result = parse_timetable(make_timetable(SAMPLE, overlay_from_hour=15))
    codes = {w["code"] for w in result["warnings"]}
    assert "grid_ends_early" in codes
    assert "block_cut" in codes
    found = as_set(result["classes"])
    assert ("MON", "09:00", "10:15") in found


def test_block_colors_are_returned():
    result = parse_timetable(make_timetable(SAMPLE))
    assert all(c["color"].startswith("#") and len(c["color"]) == 7 for c in result["classes"])
    assert all(c["color"] != "#ffffff" for c in result["classes"])


def _png(img):
    buf = BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def test_not_an_image():
    with pytest.raises(ParseError) as e:
        parse_timetable(b"hello, not an image")
    assert e.value.code == "not_image"


def test_empty_bytes():
    with pytest.raises(ParseError) as e:
        parse_timetable(b"")
    assert e.value.code == "empty"


def test_photo_is_not_timetable():
    img = Image.radial_gradient("L").resize((800, 1400)).convert("RGB")
    with pytest.raises(ParseError) as e:
        parse_timetable(_png(img))
    assert e.value.code == "not_timetable"


def test_blank_white_is_not_timetable():
    with pytest.raises(ParseError) as e:
        parse_timetable(_png(Image.new("RGB", (1080, 2000), "white")))
    assert e.value.code == "not_timetable"


def test_dark_mode_is_reported():
    with pytest.raises(ParseError) as e:
        parse_timetable(_png(Image.new("RGB", (1080, 2000), (20, 20, 22))))
    assert e.value.code == "dark_mode"


def test_six_images_under_five_seconds():
    images = [make_timetable(SAMPLE, width=1170, hour_px=120) for _ in range(6)]
    start = time.perf_counter()
    for img in images:
        parse_timetable(img)
    assert time.perf_counter() - start < 5
