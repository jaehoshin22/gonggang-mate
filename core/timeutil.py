"""시각 문자열과 분(minute) 사이 변환, 요일 상수."""

DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
WEEKDAYS = DAYS[:5]
DAY_LABELS = {
    "MON": "월", "TUE": "화", "WED": "수", "THU": "목",
    "FRI": "금", "SAT": "토", "SUN": "일",
}


def to_minutes(text):
    """'10:30' -> 630. 형식이 틀리면 ValueError."""
    if not isinstance(text, str) or ":" not in text:
        raise ValueError(f"시각 형식이 올바르지 않습니다: {text!r}")
    hour_s, minute_s = text.split(":", 1)
    if not (hour_s.isdigit() and minute_s.isdigit()):
        raise ValueError(f"시각 형식이 올바르지 않습니다: {text!r}")
    hour, minute = int(hour_s), int(minute_s)
    if not (0 <= hour <= 24 and 0 <= minute < 60) or (hour == 24 and minute):
        raise ValueError(f"존재하지 않는 시각입니다: {text!r}")
    return hour * 60 + minute


def to_hhmm(minutes):
    """630 -> '10:30'."""
    return f"{minutes // 60:02d}:{minutes % 60:02d}"
