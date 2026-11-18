import json

from core.web import MAX_IMAGE_BYTES, handle_free, handle_parse
from tests.synth import make_timetable


def test_parse_ok():
    status, body = handle_parse(make_timetable([(0, "09:00", "10:15")]))
    assert status == 200 and body["ok"]
    assert body["classes"][0]["day"] == "MON"


def test_parse_rejects_non_image():
    status, body = handle_parse(b"nope")
    assert status == 422 and body["error"]["code"] == "not_image"


def test_parse_rejects_too_large():
    status, body = handle_parse(b"0" * (MAX_IMAGE_BYTES + 1))
    assert status == 413


def test_free_ok():
    payload = {"members": [{"name": "A", "classes": []}], "min_minutes": 60}
    status, body = handle_free(json.dumps(payload).encode())
    assert status == 200 and len(body["common"]) == 5


def test_free_bad_json():
    assert handle_free(b"{oops")[0] == 400


def test_free_bad_input_message_is_korean():
    payload = {"members": [{"name": "A", "classes": []}, {"name": "A", "classes": []}]}
    status, body = handle_free(json.dumps(payload).encode())
    assert status == 400 and "중복" in body["error"]["message"]
