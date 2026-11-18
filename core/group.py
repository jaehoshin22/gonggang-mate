"""/api/group 요청 처리 (F7 그룹·초대 링크).

GET  /api/group?g=<그룹ID>                        그룹과 멤버 시간표 조회
POST /api/group {"action": "create", "name"}      그룹 만들기 -> group_id
POST /api/group {"action": "save", "group_id", "member_id"?, "name", "classes", "claim"?}
                                                  내 시간표 저장 -> member_id
POST /api/group {"action": "delete", "group_id", "member_id"}
"""

import json
import re

from .store import StoreError
from .timeutil import DAYS, to_hhmm, to_minutes

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_CLASSES = 60

ERRORS = {
    "GROUP_NOT_FOUND": (404, "그룹을 찾을 수 없습니다. 링크를 다시 확인해 주세요."),
    "MEMBER_NOT_FOUND": (404, "이미 삭제된 사람입니다. 새로고침해 주세요."),
    "NAME_TAKEN": (409, "이 그룹에 같은 이름이 이미 있습니다."),
    "GROUP_FULL": (409, "그룹에는 20명까지만 들어올 수 있습니다."),
    "BAD_DATA": (400, "시간표 형식이 올바르지 않습니다."),
    "DB_UNAVAILABLE": (503, "저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."),
    "DB_ERROR": (500, "저장 중 오류가 났습니다."),
}


def _error(status, code, message):
    return status, {"ok": False, "error": {"code": code, "message": message}}


def _uuid(value, what):
    if not isinstance(value, str) or not UUID_RE.match(value.lower()):
        raise ValueError(f"{what}가 올바르지 않습니다.")
    return value.lower()


def _clean_name(value, limit=20):
    name = str(value or "").strip()
    if not name:
        raise ValueError("이름을 입력해 주세요.")
    if len(name) > limit:
        raise ValueError(f"이름은 {limit}자 이하로 입력해 주세요.")
    return name


def _clean_classes(classes):
    if not isinstance(classes, list) or len(classes) > MAX_CLASSES:
        raise ValueError("수업 목록 형식이 올바르지 않습니다.")
    out = []
    for c in classes:
        if not isinstance(c, dict) or c.get("day") not in DAYS:
            raise ValueError("요일이 올바르지 않습니다.")
        start, end = to_minutes(c.get("start")), to_minutes(c.get("end"))
        if start >= end:
            raise ValueError("종료 시각이 시작 시각보다 늦어야 합니다.")
        color = c.get("color")
        out.append({
            "day": c["day"], "start": to_hhmm(start), "end": to_hhmm(end),
            "color": color if isinstance(color, str) and COLOR_RE.match(color) else None,
        })
    return out


def rows_to_group(group_id, rows):
    """get_group 의 JOIN 결과(수업 한 줄 = 한 행)를 멤버별로 묶는다."""
    members, order = {}, []
    for r in rows:
        mid = r.get("member_id")
        if not mid:
            continue
        if mid not in members:
            members[mid] = {"id": mid, "name": r["member_name"],
                            "updated_at": r.get("updated_at"), "classes": []}
            order.append(mid)
        if r.get("day"):
            members[mid]["classes"].append({
                "day": r["day"], "start": r["start_time"][:5], "end": r["end_time"][:5],
                "color": r.get("color"),
            })
    return {"id": group_id, "name": rows[0]["group_name"], "members": [members[m] for m in order]}


def handle_group(method, query, body, store):
    if store is None:
        return _error(503, "not_configured", "그룹 기능이 아직 설정되지 않았습니다(Supabase 환경변수 필요).")
    try:
        if method == "GET":
            gid = _uuid(query.get("g"), "그룹 링크")
            rows = store.get_group(gid)
            if not rows:
                return _error(404, "GROUP_NOT_FOUND", ERRORS["GROUP_NOT_FOUND"][1])
            return 200, {"ok": True, "group": rows_to_group(gid, rows)}

        try:
            payload = json.loads((body or b"{}").decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return _error(400, "bad_json", "요청 형식이 올바르지 않습니다.")
        if not isinstance(payload, dict):
            return _error(400, "bad_json", "요청 형식이 올바르지 않습니다.")
        action = payload.get("action")

        if action == "create":
            name = str(payload.get("name") or "").strip()[:30] or "공강 그룹"
            return 200, {"ok": True, "group_id": store.create_group(name)}

        if action == "save":
            gid = _uuid(payload.get("group_id"), "그룹 링크")
            mid = payload.get("member_id")
            mid = _uuid(mid, "멤버 정보") if mid else None
            name = _clean_name(payload.get("name"))
            classes = _clean_classes(payload.get("classes", []))
            new_id = store.save_member(gid, mid, name, classes, bool(payload.get("claim")))
            return 200, {"ok": True, "member_id": new_id}

        if action == "delete":
            gid = _uuid(payload.get("group_id"), "그룹 링크")
            mid = _uuid(payload.get("member_id"), "멤버 정보")
            return 200, {"ok": True, "deleted": store.delete_member(gid, mid)}

        return _error(400, "bad_action", "알 수 없는 요청입니다.")
    except ValueError as e:
        return _error(400, "bad_input", str(e))
    except StoreError as e:
        status, message = ERRORS.get(e.code, ERRORS["DB_ERROR"])
        return _error(status, e.code, message)
