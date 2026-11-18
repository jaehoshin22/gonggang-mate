"""/api/group — 그룹·초대 링크 (F7). 처리 내용은 core/group.py 참고.

Vercel 환경변수 SUPABASE_URL, SUPABASE_SERVICE_KEY 가 필요하다.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.group import handle_group  # noqa: E402
from core.store import make_store  # noqa: E402
from core.web import error, read_body, respond  # noqa: E402


def _query(path):
    return {k: v[0] for k, v in parse_qs(urlparse(path).query).items()}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        respond(self, *handle_group("GET", _query(self.path), b"", make_store()))

    def do_POST(self):
        body = read_body(self)
        if body is None:
            respond(self, *error(413, "too_large", "요청이 너무 큽니다."))
            return
        respond(self, *handle_group("POST", {}, body, make_store()))
