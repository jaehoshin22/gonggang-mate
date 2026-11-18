"""POST /api/parse — 시간표 캡처 한 장을 인식한다 (F1).

요청 본문: 이미지 바이트 그대로 (fetch(url, { method: 'POST', body: file }))
응답: {"ok": true, "classes": [...], "warnings": [...], "meta": {...}}
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.web import error, handle_parse, read_body, respond  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = read_body(self)
        if body is None:
            respond(self, *error(413, "too_large", "이미지가 너무 큽니다(4MB 이하)."))
            return
        respond(self, *handle_parse(body))

    def do_GET(self):
        respond(self, *error(405, "method", "POST로 이미지를 보내 주세요."))
