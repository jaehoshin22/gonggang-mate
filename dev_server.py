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
DEV = os.path.join(ROOT, "dev")
ROUTES = {"/api/parse": handle_parse, "/api/free": handle_free}


def public_stamp():
    """public/ 안 파일 중 가장 늦게 저장된 시각. 화면 모아보기가 바뀜을 알아채는 데 쓴다."""
    latest = 0
    for folder, _, files in os.walk(PUBLIC):
        for name in files:
            latest = max(latest, os.stat(os.path.join(folder, name)).st_mtime_ns // 1_000_000)
    return latest


def send_file(handler, path, content_type):
    with open(path, "rb") as f:
        data = f.read()
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # 개발 중에는 저장한 파일이 바로 보이게
        super().end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/group":
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            respond(self, *handle_group("GET", query, b"", make_store()))
            return
        if url.path == "/_screens":  # 개발용 화면 모아보기 (배포에는 포함되지 않음)
            send_file(self, os.path.join(DEV, "screens.html"), "text/html; charset=utf-8")
            return
        if url.path == "/_stamp":
            respond(self, 200, {"stamp": public_stamp()})
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
