"""POST /api/free — 공통 공강과 차선 시간을 계산한다 (F4~F6).

요청 본문: {"members": [{"name": "재호", "classes": [{"day": "MON", "start": "09:00", "end": "10:15"}]}],
            "min_minutes": 60}
응답: {"ok": true, "common": [...], "partial": [...], ...}
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.web import error, handle_free, read_body, respond  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = read_body(self)
        if body is None:
            respond(self, *error(413, "too_large", "요청이 너무 큽니다."))
            return
        respond(self, *handle_free(body))

    def do_GET(self):
        respond(self, *error(405, "method", "POST로 시간표를 보내 주세요."))
