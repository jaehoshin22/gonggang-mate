import pytest

from core.free import N_SLOTS, find_free


def member(name, *classes):
    return {
        "name": name,
        "classes": [{"day": d, "start": s, "end": e} for d, s, e in classes],
    }


def spans(result, key="common", day=None):
    return [
        (e["day"], e["start"], e["end"])
        for e in result[key]
        if day is None or e["day"] == day
    ]


def test_slot_count_is_108():
    assert N_SLOTS == 108


def test_member_without_classes_is_free_all_day():
    result = find_free([member("재호")])
    assert len(result["common"]) == 5
    assert all(e["start"] == "09:00" and e["end"] == "18:00" for e in result["common"])
    assert result["common"][0]["minutes"] == 540


def test_common_free_time_is_intersection():
    result = find_free([
        member("A", ("WED", "09:00", "12:00"), ("WED", "13:00", "18:00")),
        member("B", ("WED", "10:30", "11:45")),
    ])
    assert spans(result, day="WED") == [("WED", "12:00", "13:00")]


def test_label_format_matches_plan():
    result = find_free([member("A", ("WED", "09:00", "12:00"), ("WED", "13:00", "18:00"))])
    wed = [e for e in result["common"] if e["day"] == "WED"][0]
    assert wed["label"] == "수 12:00–13:00 (60분)"


def test_back_to_back_classes_leave_15min_break():
    # 1시간 15분 수업 두 개 사이 쉬는 시간 15분
    a = member("A", ("MON", "09:00", "10:15"), ("MON", "10:30", "11:45"), ("MON", "12:00", "18:00"))
    assert spans(find_free([a], min_minutes=5), day="MON") == [
        ("MON", "10:15", "10:30"),
        ("MON", "11:45", "12:00"),
    ]
    assert spans(find_free([a], min_minutes=30), day="MON") == []


def test_min_minutes_filter():
    a = member("A", ("TUE", "09:00", "12:00"), ("TUE", "13:30", "15:00"), ("TUE", "16:00", "18:00"))
    r60 = find_free([a], min_minutes=60)
    assert spans(r60, day="TUE") == [("TUE", "12:00", "13:30"), ("TUE", "15:00", "16:00")]
    r90 = find_free([a], min_minutes=90)
    assert spans(r90, day="TUE") == [("TUE", "12:00", "13:30")]


def test_classes_outside_range_and_weekend_are_clipped():
    a = member("A", ("THU", "08:00", "10:00"), ("THU", "17:00", "21:00"), ("SAT", "09:00", "18:00"))
    assert spans(find_free([a]), day="THU") == [("THU", "10:00", "17:00")]
    assert len(find_free([a])["common"]) == 5


def test_off_grid_times_round_toward_busy():
    a = member("A", ("FRI", "09:00", "10:02"))
    assert spans(find_free([a]), day="FRI") == [("FRI", "10:05", "18:00")]


def test_partial_when_one_person_missing():
    full = ("MON", "09:00", "18:00")
    members = [
        member("A", ("MON", "09:00", "12:00"), ("MON", "13:00", "18:00")),
        member("B", ("MON", "09:00", "12:00"), ("MON", "13:00", "18:00")),
        member("C", ("MON", "09:00", "12:00"), ("MON", "13:00", "18:00")),
        member("D", full),
    ]
    result = find_free(members, min_minutes=60)
    assert spans(result, day="MON") == []
    mon = [e for e in result["partial"] if e["day"] == "MON"]
    assert len(mon) == 1
    assert mon[0]["missing"] == ["D"]
    assert mon[0]["available"] == ["A", "B", "C"]
    assert "4명 중 3명 가능 (A, B, C)" in mon[0]["label"]


def test_partial_splits_by_missing_person():
    members = [
        member("A", ("TUE", "09:00", "12:00"), ("TUE", "14:00", "18:00")),
        member("B", ("TUE", "09:00", "12:00"), ("TUE", "14:00", "18:00")),
        member("C", ("TUE", "09:00", "13:00"), ("TUE", "14:00", "18:00")),
        member("D", ("TUE", "09:00", "12:00"), ("TUE", "13:00", "18:00")),
    ]
    tue = [e for e in find_free(members, min_minutes=60)["partial"] if e["day"] == "TUE"]
    assert [(e["start"], e["end"], e["missing"]) for e in tue] == [
        ("12:00", "13:00", ["C"]),
        ("13:00", "14:00", ["D"]),
    ]


def test_partial_needs_three_or_more_members():
    members = [member("A", ("MON", "09:00", "18:00")), member("B")]
    assert find_free(members)["partial"] == []


def test_partial_sorted_longest_first():
    members = [
        member("A", ("MON", "09:00", "18:00")),
        member("B", ("TUE", "09:00", "17:00")),
        member("C"),
    ]
    partial = find_free(members, min_minutes=60)["partial"]
    assert partial[0]["minutes"] >= partial[-1]["minutes"]


@pytest.mark.parametrize("members", [
    [],
    [{"name": "", "classes": []}],
    [{"name": "A", "classes": []}, {"name": "A", "classes": []}],
    [member("A", ("MON", "12:00", "11:00"))],
    [member("A", ("MON", "25:00", "26:00"))],
    [member("A", ("MON", "abc", "11:00"))],
])
def test_invalid_input_raises(members):
    with pytest.raises(ValueError):
        find_free(members)
