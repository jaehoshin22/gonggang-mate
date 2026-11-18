"""시연·테스트용 합성 시간표 캡처 4장을 samples/demo/ 에 만든다.

    python tools/make_samples.py

각 이미지 옆에 정답 JSON(같은 이름 .json)도 함께 만들어, tools/evaluate.py 형식을 보여 준다.
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tests.synth import make_timetable  # noqa: E402

DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT"]

PEOPLE = {
    "jaeho": [(0, "09:00", "10:15"), (0, "10:30", "11:45"), (1, "13:30", "16:30"),
              (2, "09:00", "10:15"), (3, "10:30", "11:45"), (3, "15:00", "16:15")],
    "minji": [(0, "12:00", "13:15"), (1, "09:00", "12:00"), (2, "13:30", "14:45"),
              (2, "15:00", "16:15"), (4, "10:30", "13:00")],
    "seojun": [(0, "13:30", "16:30"), (1, "10:30", "11:45"), (2, "10:30", "11:45"),
               (3, "09:00", "10:15"), (4, "13:30", "14:45")],
    "yuna": [(0, "09:00", "10:15"), (1, "15:00", "18:00"), (2, "12:00", "13:15"),
             (3, "13:30", "14:45"), (4, "09:00", "10:15"), (4, "15:00", "16:15")],
}


def main():
    out = os.path.join(ROOT, "samples", "demo")
    os.makedirs(out, exist_ok=True)
    for name, classes in PEOPLE.items():
        with open(os.path.join(out, f"{name}.png"), "wb") as f:
            f.write(make_timetable(classes, width=1170, hour_px=120))
        answer = {"classes": [{"day": DAYS[d], "start": s, "end": e} for d, s, e in classes]}
        with open(os.path.join(out, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump(answer, f, ensure_ascii=False, indent=2)
    print(f"{len(PEOPLE)}장 생성: {out}")


if __name__ == "__main__":
    main()
