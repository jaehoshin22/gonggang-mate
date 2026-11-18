"""HTTP 요청 본문 -> (상태 코드, 응답 dict). Vercel 함수와 로컬 서버가 함께 쓴다."""

import json

from .free import DEFAULT_MIN_MINUTES, find_free
from .parser import ParseError, parse_timetable

MAX_IMAGE_BYTES = 4 * 1024 * 1024  # Vercel 요청 본문 한도(4.5MB) 아래로


def error(status, code, message):
    return status, {"ok": False, "error": {"code": code, "message": message}}


def handle_parse(body):
    """본문 = 이미지 바이트 그대로 (multipart 아님)."""
    if len(body) > MAX_IMAGE_BYTES:
        return error(413, "too_large", "이미지가 너무 큽니다(4MB 이하).")
    try:
        result = parse_timetable(body)
    except ParseError as e:
        return error(422, e.code, e.message)
    return 200, {"ok": True, **result}


def handle_free(body):
    """본문 = {"members": [...], "min_minutes": 60}"""
    try:
        payload = json.loads(body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        return error(400, "bad_json", "요청 형식이 올바르지 않습니다.")
    if not isinstance(payload, dict):
        return error(400, "bad_json", "요청 형식이 올바르지 않습니다.")
    try:
        min_minutes = int(payload.get("min_minutes", DEFAULT_MIN_MINUTES))
        result = find_free(payload.get("members"), min_minutes)
    except (TypeError, ValueError) as e:
        return error(400, "bad_input", str(e))
    return 200, {"ok": True, **result}


def respond(handler, status, obj):
    """BaseHTTPRequestHandler 로 JSON 응답 보내기."""
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


def read_body(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    if length > MAX_IMAGE_BYTES + 1024:
        return None
    return handler.rfile.read(length) if length else b""
