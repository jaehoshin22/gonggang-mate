import pytest

from core.free import N_SLOTS, find_overlaps


def member(name, *classes):
    return {"name": name, "classes": [{"day": d, "start": s, "end": e} for d, s, e in classes]}


def rows(result, key="overlaps"):
    return [(e["day"], e["start"], e["end"], e["names"]) for e in result[key]]


def test_slot_count_covers_whole_day():
    assert N_SLOTS == 288


def test_only_time_between_classes_counts():
    # 첫 수업 전(9시 전)과 마지막 수업 후는 공강이 아님
    a = member("A", ("MON", "10:00", "11:00"), ("MON", "13:00", "14:00"))
    b = member("B", ("MON", "09:00", "10:00"), ("MON", "15:00", "16:00"))
    assert rows(find_overlaps([a, b])) == [("MON", "11:00", "13:00", ["A", "B"])]


def test_day_without_class_means_not_at_school():
    a = member("A", ("TUE", "09:00", "10:00"), ("TUE", "13:00", "14:00"))
    b = member("B")  # 수업 없음 -> 학교에 없음
    assert find_overlaps([a, b])["overlaps"] == []


def test_single_class_day_has_no_gap():
    a = member("A", ("WED", "09:00", "10:00"), ("WED", "13:00", "14:00"))
    b = member("B", ("WED", "12:00", "13:15"))
    assert find_overlaps([a, b])["overlaps"] == []


def test_fifteen_minute_breaks_are_dropped():
    a = member("A", ("MON", "09:00", "10:15"), ("MON", "10:30", "11:45"), ("MON", "13:30", "14:45"))
    b = member("B", ("MON", "09:00", "10:15"), ("MON", "10:30", "11:45"), ("MON", "13:30", "14:45"))
    assert rows(find_overlaps([a, b])) == [("MON", "11:45", "13:30", ["A", "B"])]


def test_names_for_each_group_and_nested_overlap():
    a = member("재호", ("THU", "09:00", "12:00"), ("THU", "15:00", "16:00"))
    b = member("민지", ("THU", "09:00", "12:00"), ("THU", "15:00", "16:00"))
    c = member("서준", ("THU", "09:00", "12:30"), ("THU", "13:30", "16:00"))
    result = find_overlaps([a, b, c])
    assert rows(result) == [
        ("THU", "12:30", "13:30", ["재호", "민지", "서준"]),  # 전원이 먼저
        ("THU", "12:00", "15:00", ["재호", "민지"]),
    ]
    assert result["overlaps"][0]["everyone"] is True
    assert result["everyone_count"] == 1
    # 그리드용 구간은 겹치지 않게 나뉨
    assert rows(result, "segments") == [
        ("THU", "12:00", "12:30", ["재호", "민지"]),
        ("THU", "12:30", "13:30", ["재호", "민지", "서준"]),
        ("THU", "13:30", "15:00", ["재호", "민지"]),
    ]


def test_pair_without_me_is_also_shown():
    me = member("나", ("FRI", "09:00", "10:00"), ("FRI", "11:00", "12:00"))
    a = member("A", ("FRI", "09:00", "10:00"), ("FRI", "15:00", "16:00"))
    b = member("B", ("FRI", "09:00", "10:00"), ("FRI", "15:00", "16:00"))
    names = [r[3] for r in rows(find_overlaps([me, a, b]))]
    assert ["A", "B"] in names
    assert ["나", "A", "B"] in names


def test_evening_gap_after_18_is_kept():
    a = member("A", ("WED", "15:00", "16:15"), ("WED", "18:25", "19:15"))
    b = member("B", ("WED", "15:00", "16:15"), ("WED", "19:00", "20:00"))
    assert rows(find_overlaps([a, b])) == [("WED", "16:15", "18:25", ["A", "B"])]


def test_weekend_classes_are_ignored():
    a = member("A", ("SAT", "09:00", "10:00"), ("SAT", "12:00", "13:00"))
    b = member("B", ("SAT", "09:00", "10:00"), ("SAT", "12:00", "13:00"))
    assert find_overlaps([a, b])["overlaps"] == []


@pytest.mark.parametrize("members", [
    [],
    [{"name": "", "classes": []}],
    [{"name": "A", "classes": []}, {"name": "A", "classes": []}],
    [member("A", ("MON", "12:00", "11:00"))],
    [member("A", ("MON", "25:00", "26:00"))],
    [member("A", ("MON", "abc", "11:00"))],
    [member(f"m{i}") for i in range(21)],
])
def test_invalid_input_raises(members):
    with pytest.raises(ValueError):
        find_overlaps(members)
