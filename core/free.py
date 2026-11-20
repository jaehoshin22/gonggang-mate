"""같이 비는 공강 찾기 (F4 공강 계산, F6 차선 시간을 '같이 비는 사람 표시'로 통합).

공강 = 각자 그날 첫 수업 시작부터 마지막 수업 끝 사이의 빈 시간 (학교에 있는 동안 비는 시간).
  - 첫 수업 전, 마지막 수업 후는 공강이 아니다 (보통 늦게 오거나 바로 집에 감)
  - 수업이 없거나 하나뿐인 날은 그 사람에게 공강이 없다 (학교에 오지 않음)

처리 흐름
1. 하루를 5분 칸으로 나누고, 사람마다 '공강인 칸'을 표시한다.
2. 칸마다 공강인 사람들의 집합을 구한다.
3. segments: 같은 사람들이 공강인 칸이 이어진 구간 (겹치지 않음 -> 그리드 표시용)
4. overlaps: 2명 이상 조합마다 '그 사람들이 모두 공강인' 가장 긴 구간 (겹칠 수 있음 -> 목록용)
   예) 재호·민지 12:00-13:30 이고 그중 12:30-13:00 은 서준도 비면
       [재호, 민지] 12:00-13:30 과 [재호, 민지, 서준] 12:30-13:00 두 줄
5. MIN_MINUTES(30분)보다 짧은 구간은 버린다 (75분 수업 사이 쉬는 시간 15분 등)

계산량: 요일 5 x 칸 288 x 멤버 N
"""

from .timeutil import DAY_LABELS, WEEKDAYS, to_hhmm, to_minutes

SLOT = 5
N_SLOTS = 24 * 60 // SLOT  # 288
MIN_MINUTES = 30
MAX_MEMBERS = 20


def validate_members(members):
    if not isinstance(members, list) or not members:
        raise ValueError("멤버가 한 명 이상 필요합니다.")
    if len(members) > MAX_MEMBERS:
        raise ValueError(f"한 번에 {MAX_MEMBERS}명까지 비교할 수 있습니다.")
    names = []
    for m in members:
        if not isinstance(m, dict):
            raise ValueError("멤버 형식이 올바르지 않습니다.")
        name = str(m.get("name", "")).strip()
        if not name:
            raise ValueError("이름이 비어 있는 멤버가 있습니다.")
        if name in names:
            raise ValueError(f"이름이 중복되었습니다: {name}")
        if not isinstance(m.get("classes", []), list):
            raise ValueError(f"{name}의 수업 목록 형식이 올바르지 않습니다.")
        names.append(name)
    return names


def _free_slots(classes):
    """{요일: [bool]*288} — True 면 그 칸이 공강 (첫 수업~마지막 수업 사이의 빈 칸)."""
    busy = {day: [False] * N_SLOTS for day in WEEKDAYS}
    for item in classes:
        day = item.get("day")
        start = to_minutes(item.get("start"))
        end = to_minutes(item.get("end"))
        if start >= end:
            raise ValueError(f"종료 시각이 시작 시각보다 늦어야 합니다: {item}")
        if day not in busy:
            continue  # 토·일 수업은 계산하지 않음
        first = start // SLOT
        last = -(-end // SLOT)  # 올림: 걸친 칸은 수업으로 본다
        for i in range(first, min(last, N_SLOTS)):
            busy[day][i] = True

    free = {}
    for day, row in busy.items():
        idx = [i for i, b in enumerate(row) if b]
        free[day] = [False] * N_SLOTS
        if not idx:
            continue  # 수업 없는 날: 학교에 없음
        for i in range(idx[0], idx[-1] + 1):
            free[day][i] = not row[i]
    return free


def _entry(day, first, last, people, names):
    start, end = first * SLOT, last * SLOT
    ordered = [n for n in names if n in people]
    return {
        "day": day,
        "day_label": DAY_LABELS[day],
        "start": to_hhmm(start),
        "end": to_hhmm(end),
        "minutes": end - start,
        "names": ordered,
        "count": len(ordered),
        "everyone": len(ordered) == len(names),
    }


def find_overlaps(members, min_minutes=MIN_MINUTES):
    """members: [{"name": str, "classes": [{"day","start","end"}]}]"""
    names = validate_members(members)
    min_minutes = max(SLOT, int(min_minutes))
    min_slots = -(-min_minutes // SLOT)
    free = {name: _free_slots(m.get("classes", [])) for name, m in zip(names, members)}

    segments, overlaps = [], []
    for day in WEEKDAYS:
        per_slot = [frozenset(n for n in names if free[n][day][i]) for i in range(N_SLOTS)]

        # 그리드용: 같은 사람들이 공강인 구간
        i = 0
        while i < N_SLOTS:
            people = per_slot[i]
            j = i
            while j < N_SLOTS and per_slot[j] == people:
                j += 1
            if len(people) >= 2 and j - i >= min_slots:
                segments.append(_entry(day, i, j, people, names))
            i = j

        # 목록용: 조합마다 모두 공강인 가장 긴 구간
        found = []
        for people in {p for p in per_slot if len(p) >= 2}:
            i = 0
            while i < N_SLOTS:
                if not people <= per_slot[i]:
                    i += 1
                    continue
                j = i
                while j < N_SLOTS and people <= per_slot[j]:
                    j += 1
                if j - i >= min_slots:
                    found.append((people, i, j))
                i = j
        # 같은 구간에 더 많은 사람이 겹치는 줄이 있으면 적은 쪽은 뺀다
        for people, i, j in found:
            if not any(other > people and oi == i and oj == j for other, oi, oj in found):
                overlaps.append(_entry(day, i, j, people, names))

    overlaps.sort(key=lambda e: (-e["count"], WEEKDAYS.index(e["day"]), e["start"]))
    segments.sort(key=lambda e: (WEEKDAYS.index(e["day"]), e["start"]))
    return {
        "member_count": len(names),
        "min_minutes": min_minutes,
        "everyone_count": sum(1 for e in overlaps if e["everyone"]),
        "overlaps": overlaps,
        "segments": segments,
    }
