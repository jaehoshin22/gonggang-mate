"""비기능 요구사항(정확성·성능) 측정 스크립트 — 11주차 측정용.

폴더 안의 캡처(png/jpg)마다 같은 이름의 정답 JSON을 두고 실행한다.

    samples/real/minji.png
    samples/real/minji.json   {"classes": [{"day": "MON", "start": "09:00", "end": "10:15"}, ...]}

    python tools/evaluate.py samples/real

판정 기준 (계획서 04)
- 정확성: 수업 블록 95% 이상 인식, 시작·종료 오차 ±5분 이내
- 성능: 캡처 6장 인식 시간 합계 5초 이내 (장당 평균 x 6 으로 환산)
"""

import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core.parser import ParseError, parse_timetable  # noqa: E402
from core.time_utils import to_minutes  # noqa: E402

TOLERANCE = 5
EXTS = (".png", ".jpg", ".jpeg", ".webp")


def match(found, want):
    """정답 블록마다 ±5분 안에 맞는 인식 결과가 있는지. (맞은 수, 오차 목록, 남은 인식 결과)"""
    remaining = list(found)
    hits, errors = 0, []
    for w in want:
        best = None
        for f in remaining:
            if f["day"] != w["day"]:
                continue
            ds = abs(to_minutes(f["start"]) - to_minutes(w["start"]))
            de = abs(to_minutes(f["end"]) - to_minutes(w["end"]))
            if ds <= TOLERANCE and de <= TOLERANCE and (best is None or ds + de < best[0]):
                best = (ds + de, f, max(ds, de))
        if best:
            hits += 1
            errors.append(best[2])
            remaining.remove(best[1])
    return hits, errors, remaining


def main(folder):
    files = sorted(f for f in os.listdir(folder) if f.lower().endswith(EXTS))
    total_want = total_hit = 0
    total_time = 0.0
    max_err = 0
    print(f"{'파일':<20}{'정답':>5}{'맞음':>5}{'오인식':>7}{'시간(ms)':>10}  경고")
    for name in files:
        stem = os.path.splitext(name)[0]
        answer_path = os.path.join(folder, stem + ".json")
        if not os.path.exists(answer_path):
            print(f"{name:<20} 정답 JSON 없음 — 건너뜀")
            continue
        with open(os.path.join(folder, name), "rb") as f:
            data = f.read()
        with open(answer_path, encoding="utf-8") as f:
            want = json.load(f)["classes"]
        start = time.perf_counter()
        try:
            result = parse_timetable(data)
        except ParseError as e:
            print(f"{name:<20}{len(want):>5}{0:>5}{'-':>7}{'-':>10}  실패: {e.code}")
            total_want += len(want)
            continue
        elapsed = time.perf_counter() - start
        hits, errors, extra = match(result["classes"], want)
        total_want += len(want)
        total_hit += hits
        total_time += elapsed
        max_err = max([max_err] + errors)
        codes = ",".join(w["code"] for w in result["warnings"])
        print(f"{name:<20}{len(want):>5}{hits:>5}{len(extra):>7}{elapsed * 1000:>10.0f}  {codes}")
        for f in extra:
            print(f"{'':<20}  오인식: {f['day']} {f['start']}-{f['end']}")

    if not total_want:
        print("평가할 파일이 없습니다.")
        return 1
    accuracy = total_hit / total_want * 100
    per_six = total_time / max(1, len(files)) * 6
    print()
    print(f"정확성: {total_hit}/{total_want} = {accuracy:.1f}%  (기준 95% 이상) -> {'통과' if accuracy >= 95 else '미달'}")
    print(f"최대 시각 오차: {max_err}분  (기준 5분 이내)")
    print(f"6장 환산 인식 시간: {per_six:.2f}초  (기준 5초 이내, 네트워크 제외) -> {'통과' if per_six <= 5 else '미달'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "samples", "demo")))
