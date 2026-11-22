"""그룹 저장소 (F7).

- SupabaseStore: Supabase(PostgREST)의 SQL 함수를 HTTP로 호출한다. supabase/schema.sql 참고.
  키는 서버 환경변수(SUPABASE_URL, SUPABASE_SERVICE_KEY)에만 두고 브라우저에는 보내지 않는다.
- MemoryStore: 로컬 개발·테스트용. 서버를 끄면 사라진다.

두 저장소는 같은 메서드와 같은 오류 코드(StoreError.code)를 쓴다.
"""

import json
import os
import threading
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

KNOWN_ERRORS = {"GROUP_NOT_FOUND", "MEMBER_NOT_FOUND", "NAME_TAKEN", "GROUP_FULL"}
MAX_MEMBERS = 20


class StoreError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class SupabaseStore:
    def __init__(self, url, key, timeout=8):
        self.url = url.rstrip("/")
        self.key = key
        self.timeout = timeout

    def _headers(self):
        headers = {"apikey": self.key, "Content-Type": "application/json", "Accept": "application/json"}
        # 새 secret 키(sb_secret_...)는 JWT가 아니라 apikey 헤더로만 보낸다.
        # 예전 service_role 키(eyJ...로 시작하는 JWT)는 Authorization 헤더도 함께 쓴다.
        if self.key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {self.key}"
        return headers

    def _rpc(self, fn, args):
        req = urllib.request.Request(
            f"{self.url}/rest/v1/rpc/{fn}",
            data=json.dumps(args).encode("utf-8"),
            method="POST",
            headers=self._headers(),
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                body = res.read()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as e:
            try:
                info = json.loads(e.read() or b"{}")
            except ValueError:
                info = {}
            message = info.get("message", "")
            if message in KNOWN_ERRORS:
                raise StoreError(message)
            if str(info.get("code", "")).startswith(("22", "23")):  # 형식·제약조건 위반
                raise StoreError("BAD_DATA")
            raise StoreError("DB_ERROR")
        except (urllib.error.URLError, TimeoutError):
            raise StoreError("DB_UNAVAILABLE")

    def create_group(self, name):
        return self._rpc("create_group", {"p_name": name})

    def get_group(self, group_id):
        return self._rpc("get_group", {"p_group": group_id}) or []

    def save_member(self, group_id, member_id, name, classes, claim=False):
        return self._rpc("save_member", {
            "p_group": group_id, "p_member": member_id, "p_name": name,
            "p_classes": classes, "p_claim": claim,
        })


class MemoryStore:
    """schema.sql 의 함수와 같은 규칙을 메모리에서 흉내 낸다."""

    def __init__(self):
        self.groups = {}   # id -> {"name", "members": {id: {"name", "updated_at", "classes"}}}
        self.lock = threading.Lock()

    def create_group(self, name):
        gid = str(uuid.uuid4())
        with self.lock:
            self.groups[gid] = {"name": (name or "").strip() or "공강 그룹", "members": {}}
        return gid

    def get_group(self, group_id):
        g = self.groups.get(group_id)
        if not g:
            return []
        rows = []
        # 저장 시각 순. 시각이 같으면(Windows 는 시계 해상도가 거칠다) 저장한 순서를 유지한다
        members = sorted(g["members"].items(), key=lambda kv: kv[1]["updated_at"])
        for mid, m in members:
            base = {"group_name": g["name"], "member_id": mid, "member_name": m["name"],
                    "updated_at": m["updated_at"]}
            if not m["classes"]:
                rows.append({**base, "day": None, "start_time": None, "end_time": None, "color": None})
            for c in sorted(m["classes"], key=lambda c: (c["day"], c["start"])):
                rows.append({**base, "day": c["day"], "start_time": c["start"],
                             "end_time": c["end"], "color": c.get("color")})
        if not members:
            rows.append({"group_name": g["name"], "member_id": None, "member_name": None,
                         "updated_at": None, "day": None, "start_time": None,
                         "end_time": None, "color": None})
        return rows

    def save_member(self, group_id, member_id, name, classes, claim=False):
        with self.lock:
            g = self.groups.get(group_id)
            if not g:
                raise StoreError("GROUP_NOT_FOUND")
            existing = next((mid for mid, m in g["members"].items() if m["name"] == name), None)
            now = datetime.now(timezone.utc).isoformat()
            if member_id:
                if member_id not in g["members"]:
                    raise StoreError("MEMBER_NOT_FOUND")
                if existing and existing != member_id:
                    raise StoreError("NAME_TAKEN")
                mid = member_id
            elif existing:
                if not claim:
                    raise StoreError("NAME_TAKEN")
                mid = existing
            else:
                if len(g["members"]) >= MAX_MEMBERS:
                    raise StoreError("GROUP_FULL")
                mid = str(uuid.uuid4())
            g["members"][mid] = {"name": name, "updated_at": now, "classes": list(classes)}
            return mid


_memory = MemoryStore()


def make_store():
    """환경변수가 있으면 Supabase, 로컬이면 메모리. Vercel에서 설정이 없으면 None."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if url and key:
        return SupabaseStore(url, key)
    if os.environ.get("VERCEL"):
        return None  # 배포 환경에서 메모리 저장은 함수가 꺼질 때 사라지므로 쓰지 않는다
    return _memory
