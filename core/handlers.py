"""서버 예외 처리의 중심: 요청 본문을 검사하고, 오류를 상태 코드와 JSON 응답으로 바꾼다.

Vercel 함수(api/*.py)와 로컬 서버(dev_server.py)가 함께 쓴다.
  - 이미지가 너무 큼 413, 시간표 인식 실패 422, 잘못된 요청 400 은 모두 여기서 만든다.
  - 인식·공강 계산·그룹 규칙은 다른 파일(parser, free, group)이 하고, 여기는 호출과 변환만 한다.
화면 쪽 예외 처리는 public/js/errors.js.
"""

import json

from .free import find_overlaps
from .parser import ParseError, parse_timetable

MAX_IMAGE_BYTES = 4 * 1024 * 1024  # Vercel 요청 본문 한도(4.5MB) 아래로


def error(status, code, message):
    return status, {"ok": False, "error": {"code": code, "message": message}}


def handle_parse(body):
    """본문 = 이미지 바이트 그대로 (multipart 아님)."""
    if len(body) > MAX_IMAGE_BYTES:
        return error(413, "too_large", "이미지가 너무 커요. 4MB 이하로 올려 주세요.")
    try:
        result = parse_timetable(body)
    except ParseError as e:
        return error(422, e.code, e.message)
    return 200, {"ok": True, **result}


def handle_free(body):
    """본문 = {"members": [...]}  -> 수업 사이에 같이 비는 시간과 사람 이름"""
    try:
        payload = json.loads(body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        return error(400, "bad_json", "요청 형식이 올바르지 않아요.")
    if not isinstance(payload, dict):
        return error(400, "bad_json", "요청 형식이 올바르지 않아요.")
    try:
        result = find_overlaps(payload.get("members"))
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
