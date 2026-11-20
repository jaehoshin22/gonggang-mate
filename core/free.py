"""공통 공강 계산 (F4 공통 공강, F5 최소 시간 필터, F6 차선 시간).

처리 흐름 (계획서 05 - 4, 5단계)
1. 하루 09:00~18:00 을 5분 칸 108개로 나눈다.
2. 멤버마다 수업이 있는 칸을 표시하고, 칸마다 비어 있는 사람을 모은다.
3. 전원이 비어 있는 칸이 이어진 구간 = 공통 공강.
4. 정확히 한 명만 안 되는 칸이 이어진 구간 = 차선 시간 (3명 이상일 때). 되는 사람 이름을 함께 준다.
5. 최소 시간보다 짧은 구간은 버린다.

수업이 하나도 없는 요일은 그 사람이 '비어 있음'으로 처리한다.
계산량: 요일 5 x 칸 108 x 멤버 N -> O(N)
"""

from .timeutil import DAY_LABELS, WEEKDAYS, to_hhmm, to_minutes

RANGE_START = 9 * 60
RANGE_END = 18 * 60
SLOT = 5
N_SLOTS = (RANGE_END - RANGE_START) // SLOT  # 108
DEFAULT_MIN_MINUTES = 30


def _busy_slots(classes):
    """{요일: [bool]*108} — True 면 수업 있음. 범위 밖 시간과 주말은 무시."""
    busy = {day: [False] * N_SLOTS for day in WEEKDAYS}
    for item in classes:
        day = item.get("day")
        start = to_minutes(item.get("start"))
        end = to_minutes(item.get("end"))
        if start >= end:
            raise ValueError(f"종료 시각이 시작 시각보다 늦어야 합니다: {item}")
        if day not in busy:
            continue  # 토·일 수업은 공강 계산 대상이 아님
        start = max(start, RANGE_START)
        end = min(end, RANGE_END)
        if start >= end:
            continue
        first = (start - RANGE_START) // SLOT
        last = -(-(end - RANGE_START) // SLOT)  # 올림: 걸친 칸은 수업으로 본다
        for i in range(first, last):
            busy[day][i] = True
    return busy


def _runs(flags):
    """[True, True, False, True] -> [(0, 2), (3, 4)]  (끝은 미포함)."""
    runs, start = [], None
    for i, flag in enumerate(flags + [False]):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            runs.append((start, i))
            start = None
    return runs


def _slot_entry(day, first, last):
    start = RANGE_START + first * SLOT
    end = RANGE_START + last * SLOT
    minutes = end - start
    return {
        "day": day,
        "day_label": DAY_LABELS[day],
        "start": to_hhmm(start),
        "end": to_hhmm(end),
        "minutes": minutes,
        "label": f"{DAY_LABELS[day]} {to_hhmm(start)}–{to_hhmm(end)} ({minutes}분)",
    }


def validate_members(members):
    if not isinstance(members, list) or not members:
        raise ValueError("멤버가 한 명 이상 필요합니다.")
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


def find_free(members, min_minutes=DEFAULT_MIN_MINUTES):
    """members: [{"name": str, "classes": [{"day","start","end"}]}]"""
    names = validate_members(members)
    min_minutes = max(SLOT, int(min_minutes))
    busy = {name: _busy_slots(m.get("classes", [])) for name, m in zip(names, members)}
    n = len(names)

    common, partial = [], []
    for day in WEEKDAYS:
        # 칸마다 비어 있는 사람
        free_people = [
            [name for name in names if not busy[name][day][i]] for i in range(N_SLOTS)
        ]

        for first, last in _runs([len(p) == n for p in free_people]):
            if (last - first) * SLOT >= min_minutes:
                common.append(_slot_entry(day, first, last))

        if n >= 3:
            # 같은 사람이 빠지는 칸끼리 묶는다
            missing = [
                next(x for x in names if x not in p) if len(p) == n - 1 else None
                for p in free_people
            ]
            i = 0
            while i < N_SLOTS:
                who = missing[i]
                if who is None:
                    i += 1
                    continue
                j = i
                while j < N_SLOTS and missing[j] == who:
                    j += 1
                if (j - i) * SLOT >= min_minutes:
                    entry = _slot_entry(day, i, j)
                    entry["missing"] = [who]
                    entry["available"] = [x for x in names if x != who]
                    entry["label"] += f" · {n}명 중 {n - 1}명 가능 ({', '.join(entry['available'])})"
                    partial.append(entry)
                i = j

    partial.sort(key=lambda e: (-e["minutes"], WEEKDAYS.index(e["day"]), e["start"]))
    return {
        "member_count": n,
        "min_minutes": min_minutes,
        "range": {"start": to_hhmm(RANGE_START), "end": to_hhmm(RANGE_END)},
        "common": common,
        "partial": partial,
    }
