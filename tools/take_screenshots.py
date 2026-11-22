"""README 용 실행 화면 캡처. 개발 서버를 띄우고 시연용 합성 캡처(samples/demo)로 화면을 눌러 저장한다.

실행: python tools/take_screenshots.py      (playwright 와 크롬 필요, tests/conftest.py 참고)
결과: docs/screens/*.png  (휴대폰 크기 390x844)
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core.free import find_overlaps  # noqa: E402
from tests.synth import make_timetable  # noqa: E402

OUT = os.path.join(ROOT, "docs", "screens")
DAYS = ["MON", "TUE", "WED", "THU", "FRI"]

# 결과 화면이 보이도록 공강이 겹치게 짠 합성 시간표 (samples/demo 는 인식 테스트용이라 공강이 거의 없다)
PEOPLE = {
    "재호": [(0, "09:00", "10:15"), (0, "13:30", "14:45"), (1, "10:30", "11:45"), (1, "15:00", "16:15"),
            (2, "09:00", "10:15"), (2, "14:00", "15:15"), (3, "10:30", "11:45"), (4, "13:30", "14:45")],
    "민지": [(0, "09:00", "10:15"), (0, "15:00", "16:15"), (1, "09:00", "10:15"), (1, "14:00", "15:15"),
            (2, "10:30", "11:45"), (2, "15:00", "16:15"), (3, "09:00", "10:15"), (3, "13:30", "14:45")],
    "서준": [(0, "10:30", "11:45"), (0, "15:00", "16:15"), (1, "10:30", "11:45"), (1, "16:00", "17:15"),
            (2, "09:00", "10:15"), (2, "14:00", "15:15"), (4, "10:30", "11:45"), (4, "15:00", "16:15")],
    "유나": [(0, "09:00", "10:15"), (0, "14:00", "15:15"), (1, "09:00", "10:15"), (1, "15:00", "16:15"),
            (3, "10:30", "11:45"), (3, "14:00", "15:15"), (4, "09:00", "10:15"), (4, "13:30", "14:45")],
}


def start_server():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = {k: v for k, v in os.environ.items() if k not in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY")}
    proc = subprocess.Popen([sys.executable, "dev_server.py", str(port)], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            urllib.request.urlopen(url + "/", timeout=1)
            return proc, url
        except OSError:
            time.sleep(0.1)
    proc.kill()
    raise SystemExit("개발 서버가 뜨지 않았어요")


def post(base, body):
    req = urllib.request.Request(base + "/api/group", json.dumps(body).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def make_captures(folder):
    paths = {}
    for name, classes in PEOPLE.items():
        paths[name] = os.path.join(folder, f"{name}.png")
        with open(paths[name], "wb") as f:
            f.write(make_timetable(classes, width=1170, hour_px=120))
    return paths


def answers(name):
    return [{"day": DAYS[d], "start": a, "end": b} for d, a, b in PEOPLE[name]]


def main():
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp()
    CAP = make_captures(tmp)
    check = find_overlaps([{"name": n, "classes": answers(n)} for n in PEOPLE])
    assert check["segments"], "합성 시간표에 같이 비는 시간이 없어요"
    proc, base = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("E2E_CHROME") or None, args=["--no-sandbox"])
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
            page = ctx.new_page()

            def shot(name, full=False):
                page.wait_for_timeout(300)
                page.screenshot(path=os.path.join(OUT, name), full_page=full)
                print("saved", name)

            def step(name):
                page.wait_for_selector(f"#step-{name}:not([hidden])")

            # 1 첫 화면
            page.goto(base + "/")
            step("home")
            shot("01-home.png")

            # 2 내 시간표 인식 결과 확인·수정 (혼자 비교하기)
            page.click("#solo-start")
            step("solo")
            page.click("#solo-action button")
            step("join")
            page.fill("#join-name", "재호")
            page.set_input_files("#join-file", CAP["재호"])
            page.click("#join-next")
            page.wait_for_selector("#step-review:not([hidden]) .class-row")
            shot("02-review.png")

            # 3 예외 처리: 겹치는 수업은 다음 단계로 못 넘어간다
            page.evaluate("state.draft.classes.push({...state.draft.classes[0]}); renderReview();")
            page.click("#review-next")
            page.wait_for_selector("#overlap-msg")
            shot("03-overlap-blocked.png")

            # 정상으로 되돌려 저장
            page.evaluate("state.draft.classes.pop(); state.draft.overlaps = null; renderReview();")
            page.click("#review-next")
            step("solo")

            # 4 예외 처리: 같은 이름은 입력 칸 아래에 안내
            page.click("#solo-action button")
            step("join")
            page.set_input_files("#join-file", [CAP["민지"], CAP["서준"], CAP["유나"]])
            page.wait_for_selector(".friend-card")
            names = page.locator(".friend-card input")
            for i, n in enumerate(["민지", "민지", "유나"]):
                names.nth(i).fill(n)
            page.click("#join-next")
            page.wait_for_selector(".friend-card .field-error")
            shot("04-same-name-error.png", full=True)

            # 5 혼자 비교하기 결과
            names.nth(1).fill("서준")
            page.click("#join-next")
            step("solo")
            page.wait_for_selector(".tt-block.slot")
            shot("05-solo-result.png", full=True)

            # 6 칸 상세 팝업
            page.locator(".tt-block.slot").first.click()
            page.wait_for_selector(".modal")
            shot("06-detail-popup.png")
            page.go_back()

            # 7 그룹 결과 (링크로 모은 화면)
            gid = post(base, {"action": "create", "name": "밥약 그룹"})["group_id"]
            for n in ("재호", "민지", "서준"):
                post(base, {"action": "save", "group_id": gid, "name": n, "classes": answers(n)})
            page.goto(base + f"/?g={gid}")
            step("group")
            page.wait_for_selector(".tt-block.slot")
            shot("07-group-result.png", full=True)
            browser.close()
    finally:
        proc.kill()


if __name__ == "__main__":
    main()
