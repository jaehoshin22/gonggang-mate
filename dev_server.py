"""로컬 개발 서버. Vercel CLI 없이 `python dev_server.py` 로 화면과 API를 함께 띄운다.

같은 와이파이의 휴대폰에서 http://<내 PC IP>:8000 으로 접속해 볼 수 있다.
그룹 기능(F7)은 SUPABASE_URL, SUPABASE_SERVICE_KEY 환경변수가 있으면 Supabase에,
없으면 메모리에 저장한다(서버를 끄면 사라짐).
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from core.group import handle_group
from core.store import make_store
from core.web import error, handle_free, handle_parse, read_body, respond

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
ROUTES = {"/api/parse": handle_parse, "/api/free": handle_free}


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC, **kwargs)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/group":
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            respond(self, *handle_group("GET", query, b"", make_store()))
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        body = read_body(self)
        if body is None:
            respond(self, *error(413, "too_large", "요청이 너무 큽니다."))
        elif path == "/api/group":
            respond(self, *handle_group("POST", {}, body, make_store()))
        elif path in ROUTES:
            respond(self, *ROUTES[path](body))
        else:
            respond(self, *error(404, "not_found", "없는 주소입니다."))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    store = "Supabase" if os.environ.get("SUPABASE_URL") else "메모리(개발용)"
    print(f"공강메이트 개발 서버: http://localhost:{port}  그룹 저장소: {store}")
    ThreadingHTTPServer(("0.0.0.0", port), DevHandler).serve_forever()
