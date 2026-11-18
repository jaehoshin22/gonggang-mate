"""로컬 개발 서버. Vercel CLI 없이 `python dev_server.py` 로 화면과 API를 함께 띄운다.

같은 와이파이의 휴대폰에서 http://<내 PC IP>:8000 으로 접속해 볼 수 있다.
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from core.web import error, handle_free, handle_parse, read_body, respond

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
ROUTES = {"/api/parse": handle_parse, "/api/free": handle_free}


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC, **kwargs)

    def do_POST(self):
        route = ROUTES.get(self.path.split("?")[0])
        if route is None:
            respond(self, *error(404, "not_found", "없는 주소입니다."))
            return
        body = read_body(self)
        if body is None:
            respond(self, *error(413, "too_large", "요청이 너무 큽니다."))
            return
        respond(self, *route(body))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"공강메이트 개발 서버: http://localhost:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), DevHandler).serve_forever()
