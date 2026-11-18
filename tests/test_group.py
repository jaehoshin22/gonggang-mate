"""그룹 API (F7) 테스트.

- 기본: 메모리 저장소로 규칙을 확인한다.
- PG_TEST_DSN 환경변수가 있으면 실제 PostgreSQL에 schema.sql을 적용하고,
  Supabase(PostgREST)와 같은 방식으로 함수를 호출하는 가짜 서버를 띄워 SupabaseStore까지 검증한다.
"""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from core.group import handle_group
from core.store import MemoryStore, SupabaseStore

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JAEHO = [{"day": "MON", "start": "09:00", "end": "11:50", "color": "#f28c8c"},
         {"day": "WED", "start": "13:30", "end": "14:45"}]


def post(store, **payload):
    return handle_group("POST", {}, json.dumps(payload).encode(), store)


def get(store, gid):
    return handle_group("GET", {"g": gid}, b"", store)


# ---- 가짜 Supabase(PostgREST) ------------------------------------------------

def _postgrest_server(dsn):
    psycopg = pytest.importorskip("psycopg")
    from psycopg.rows import dict_row

    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("drop table if exists classes, members, groups cascade")
        conn.execute(open(os.path.join(ROOT, "supabase", "schema.sql"), encoding="utf-8").read())

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            fn = self.path.rsplit("/", 1)[-1]
            args = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            names = ", ".join(f"{k} => %({k})s" for k in args)
            params = {k: json.dumps(v) if isinstance(v, (list, dict)) else v for k, v in args.items()}
            try:
                with psycopg.connect(dsn, autocommit=True, row_factory=dict_row) as conn:
                    rows = conn.execute(f"select * from {fn}({names})", params).fetchall()
                if fn == "get_group":
                    out = [{k: (str(v) if v is not None and k in ("member_id", "updated_at") else v)
                            for k, v in r.items()} for r in rows]
                else:
                    value = list(rows[0].values())[0]
                    out = str(value) if fn in ("create_group", "save_member") else value
                status, data = 200, out
            except psycopg.Error as e:
                status, data = 400, {"code": e.sqlstate, "message": e.diag.message_primary}
            raw = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


@pytest.fixture(params=["memory", "supabase"])
def store(request):
    if request.param == "memory":
        yield MemoryStore()
        return
    dsn = os.environ.get("PG_TEST_DSN")
    if not dsn:
        pytest.skip("PG_TEST_DSN 이 없어 Supabase 연동 테스트를 건너뜀")
    server = _postgrest_server(dsn)
    yield SupabaseStore(f"http://127.0.0.1:{server.server_port}", "test-key")
    server.shutdown()


# ---- 테스트 -------------------------------------------------------------------

def test_create_save_and_get(store):
    status, body = post(store, action="create", name="밥약 그룹")
    assert status == 200
    gid = body["group_id"]
    status, body = post(store, action="save", group_id=gid, name="재호", classes=JAEHO)
    assert status == 200 and body["member_id"]
    post(store, action="save", group_id=gid, name="민지", classes=[])

    status, body = get(store, gid)
    assert status == 200
    group = body["group"]
    assert group["name"] == "밥약 그룹"
    assert [m["name"] for m in group["members"]] == ["재호", "민지"]
    jaeho = group["members"][0]
    assert {(c["day"], c["start"], c["end"]) for c in jaeho["classes"]} == {
        ("MON", "09:00", "11:50"), ("WED", "13:30", "14:45")}
    assert group["members"][1]["classes"] == []


def test_same_name_needs_claim(store):
    gid = post(store, action="create", name="")[1]["group_id"]
    first = post(store, action="save", group_id=gid, name="재호", classes=JAEHO)[1]["member_id"]

    status, body = post(store, action="save", group_id=gid, name="재호", classes=[])
    assert status == 409 and body["error"]["code"] == "NAME_TAKEN"

    status, body = post(store, action="save", group_id=gid, name="재호", classes=[], claim=True)
    assert status == 200 and body["member_id"] == first
    assert get(store, gid)[1]["group"]["members"][0]["classes"] == []


def test_update_own_member_and_rename(store):
    gid = post(store, action="create", name="g")[1]["group_id"]
    mid = post(store, action="save", group_id=gid, name="민지", classes=[])[1]["member_id"]
    post(store, action="save", group_id=gid, name="재호", classes=[])
    # 다른 사람 이름으로는 못 바꿈
    assert post(store, action="save", group_id=gid, member_id=mid, name="재호", classes=[])[0] == 409
    status, body = post(store, action="save", group_id=gid, member_id=mid, name="민지B", classes=JAEHO)
    assert status == 200 and body["member_id"] == mid
    names = [m["name"] for m in get(store, gid)[1]["group"]["members"]]
    assert sorted(names) == ["민지B", "재호"]


def test_delete_member(store):
    gid = post(store, action="create", name="g")[1]["group_id"]
    mid = post(store, action="save", group_id=gid, name="재호", classes=[])[1]["member_id"]
    assert post(store, action="delete", group_id=gid, member_id=mid)[1]["deleted"] is True
    assert post(store, action="delete", group_id=gid, member_id=mid)[1]["deleted"] is False
    assert get(store, gid)[1]["group"]["members"] == []


def test_missing_group(store):
    gid = "00000000-0000-4000-8000-000000000000"
    assert get(store, gid)[0] == 404
    status, body = post(store, action="save", group_id=gid, name="x", classes=[])
    assert status == 404 and body["error"]["code"] == "GROUP_NOT_FOUND"


@pytest.mark.parametrize("payload, message", [
    ({"name": "", "classes": []}, "이름"),
    ({"name": "가" * 21, "classes": []}, "20자"),
    ({"name": "a", "classes": [{"day": "XYZ", "start": "09:00", "end": "10:00"}]}, "요일"),
    ({"name": "a", "classes": [{"day": "MON", "start": "12:00", "end": "11:00"}]}, "종료"),
    ({"name": "a", "classes": "nope"}, "형식"),
])
def test_invalid_save_is_rejected(payload, message):
    store = MemoryStore()
    gid = post(store, action="create", name="g")[1]["group_id"]
    status, body = post(store, action="save", group_id=gid, **payload)
    assert status == 400 and message in body["error"]["message"]


def test_bad_group_id_and_action():
    store = MemoryStore()
    assert handle_group("GET", {"g": "not-a-uuid"}, b"", store)[0] == 400
    assert handle_group("GET", {}, b"", store)[0] == 400
    assert post(store, action="hack")[0] == 400
    assert handle_group("POST", {}, b"{bad", store)[0] == 400


def test_not_configured_returns_503():
    status, body = handle_group("GET", {"g": "x"}, b"", None)
    assert status == 503 and body["error"]["code"] == "not_configured"


def test_bad_color_is_dropped():
    store = MemoryStore()
    gid = post(store, action="create", name="g")[1]["group_id"]
    classes = [{"day": "MON", "start": "9:00", "end": "10:15", "color": "red;}"}]
    post(store, action="save", group_id=gid, name="a", classes=classes)
    c = get(store, gid)[1]["group"]["members"][0]["classes"][0]
    assert c == {"day": "MON", "start": "09:00", "end": "10:15", "color": None}


def test_supabase_headers_for_new_and_legacy_keys():
    new = SupabaseStore("https://x.supabase.co", "sb_secret_abc")._headers()
    assert new["apikey"] == "sb_secret_abc" and "Authorization" not in new
    legacy = SupabaseStore("https://x.supabase.co", "eyJhbGciOi.legacy")._headers()
    assert legacy["Authorization"] == "Bearer eyJhbGciOi.legacy"
