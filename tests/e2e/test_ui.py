"""화면 흐름 테스트 (Playwright). 개발 서버를 직접 띄워서 실제 브라우저로 누른다.

혼자 비교하기(내 시간표 -> 친구 카드), 확인 화면, 뒤로가기(History API), 그룹, 이미지 저장 팝업을 확인한다.
실행: python -m pytest tests/e2e --e2e -q   (준비는 tests/conftest.py 참고)
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

playwright = pytest.importorskip("playwright.sync_api")
from PIL import Image  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEMO = os.path.join(ROOT, "samples", "demo")
CAPTURES = {n: os.path.join(DEMO, f"{n}.png") for n in ("jaeho", "minji", "seojun", "yuna")}


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def base_url():
    if not all(os.path.exists(p) for p in CAPTURES.values()):
        pytest.skip("samples/demo 캡처가 없어요 (python tools/make_samples.py)")
    port = free_port()
    env = {k: v for k, v in os.environ.items() if k not in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY")}  # 항상 메모리 저장소
    proc = subprocess.Popen([sys.executable, "dev_server.py", str(port)], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            urllib.request.urlopen(url + "/", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    else:
        proc.kill()
        pytest.fail("개발 서버가 뜨지 않았어요")
    yield url
    proc.kill()


@pytest.fixture(scope="session")
def browser():
    with playwright.sync_playwright() as p:
        try:
            b = p.chromium.launch(executable_path=os.environ.get("E2E_CHROME") or None, args=["--no-sandbox"])
        except Exception as err:  # 브라우저 미설치
            pytest.skip(f"브라우저를 열 수 없어요: {err}")
        yield b
        b.close()


@pytest.fixture
def blank_capture(tmp_path):
    path = tmp_path / "blank.png"
    Image.new("RGB", (300, 600), "white").save(path)  # 시간표가 아니라서 인식에 실패한다
    return str(path)


class Ui:
    """한 화면(페이지)을 다루는 작은 도우미."""

    def __init__(self, page, base):
        self.page, self.base = page, base
        self.errors = []
        page.on("pageerror", lambda e: self.errors.append(str(e)))

    def open(self, path="/"):
        self.page.goto(self.base + path)
        self.page.wait_for_selector("main > .step:not([hidden])")

    def visible(self, step):
        return self.page.is_visible(f"#step-{step}")

    def wait(self, step):
        self.page.wait_for_selector(f"#step-{step}:not([hidden])")

    @property
    def path(self):
        return self.page.evaluate("location.pathname + location.search")

    def solo_start(self):
        self.open("/")
        self.page.click("#solo-start")
        self.wait("solo")

    def add_me(self, name="재호", capture="jaeho", finish=True):
        p = self.page
        p.click("#solo-action button")
        self.wait("join")
        p.fill("#join-name", name)
        p.set_input_files("#join-file", CAPTURES[capture])
        p.click("#join-next")
        p.wait_for_selector("#step-review:not([hidden]) .class-row")
        if finish:
            p.click("#review-next")
            self.wait("solo")

    def open_friend_upload(self, files):
        self.page.click("#solo-action button")
        self.wait("join")
        self.page.set_input_files("#join-file", files)

    def card_names(self):
        return [i.input_value() for i in self.page.locator(".friend-card input").all()]

    def fill_cards(self, names):
        for i, n in enumerate(names):
            self.page.locator(".friend-card input").nth(i).fill(n)

    def members(self):
        return self.page.evaluate("state.solo.members.map(m => m.name)")


@pytest.fixture
def ui(browser, base_url):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, accept_downloads=True)
    page = ctx.new_page()
    u = Ui(page, base_url)
    yield u
    ctx.close()
    assert not u.errors, u.errors  # 화면 스크립트 오류가 하나도 없어야 한다


def post_group(base, body):
    req = urllib.request.Request(base + "/api/group", json.dumps(body).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


# ---- 혼자 비교하기 ------------------------------------------------------------------------
def test_solo_me_first_then_friend_cards(ui):
    ui.solo_start()
    assert ui.page.inner_text("#solo-action button") == "내 시간표 올리기"
    ui.add_me()
    assert ui.page.locator("#solo-action button").count() == 1  # 내 시간표는 바꾸거나 빼지 않는다
    assert ui.page.inner_text("#solo-action button") == "친구 시간표 추가"
    first = ui.page.locator("#solo-people li").first
    assert first.inner_text().replace("\n", " ").strip() == "재호 나" and first.locator("button").count() == 0

    ui.open_friend_upload([CAPTURES["minji"], CAPTURES["seojun"], CAPTURES["yuna"]])
    assert not ui.page.is_visible("#join-name")  # 친구 이름은 카드에서 받는다
    assert ui.page.locator(".friend-card").count() == 3

    ui.page.click("#join-next")  # 이름 없이는 넘어가지 않는다
    assert "모두 적어" in ui.page.inner_text("#join-error")
    ui.fill_cards(["민지", "민지", "유나"])
    ui.page.click("#join-next")
    assert "이미 있는 이름" in ui.page.inner_text("#join-error")
    ui.fill_cards(["민지", "서준", "유나"])
    ui.fill_cards(["재호"])  # 내 이름과 겹침
    ui.page.click("#join-next")
    assert "이미 있는 이름" in ui.page.inner_text("#join-error")
    ui.fill_cards(["민지"])

    ui.page.click(".friend-card >> nth=2 >> button[aria-label='이 캡처 빼기']")
    assert ui.page.locator(".friend-card").count() == 2
    ui.page.set_input_files("#join-file", CAPTURES["yuna"])  # 더 추가
    assert ui.page.locator(".friend-card").count() == 3
    ui.fill_cards(["민지", "서준", "유나"])

    ui.page.click(".friend-card >> nth=0 >> .thumb-btn")  # 썸네일 확대, 뒤로가기는 팝업만 닫는다
    ui.page.wait_for_selector(".capture-card")
    ui.page.go_back()
    ui.page.wait_for_timeout(200)
    assert ui.page.locator(".capture-card").count() == 0 and ui.visible("join")

    ui.page.click("#join-next")  # 모두 정상 인식: 확인 화면 없이 바로 추가
    ui.wait("solo")
    ui.page.wait_for_function("state.solo.members.length === 4")
    assert ui.members() == ["재호", "민지", "서준", "유나"]
    assert ui.path == "/?view=solo"
    ui.page.go_back()  # 올리기 화면 기록이 남지 않아서 한 번에 홈으로
    ui.wait("home")


def test_friend_review_only_for_problem_captures_and_back_keeps_only_remaining(ui, blank_capture):
    """정상 장은 바로 추가, 인식 실패 장만 확인. 확인 화면에서 취소해도 이미 추가된 장은 카드에서 빠져 있다."""
    ui.solo_start()
    ui.add_me()
    ui.open_friend_upload([CAPTURES["minji"], blank_capture, blank_capture])
    ui.fill_cards(["민지", "빈1", "빈2"])
    ui.page.click("#join-next")
    ui.wait("review")
    assert "(1/2)" in ui.page.inner_text("#review-panel h2")
    assert ui.page.locator(".source-thumb").count() == 1
    assert ui.page.inner_text("#review-back") == "취소"
    assert ui.page.inner_text("#review-next") == "다음"
    assert ui.members() == ["재호", "민지"]  # 정상 인식된 민지는 이미 추가됨

    ui.page.click("#review-back")  # 취소: 올리기 화면에는 남은 두 장만
    ui.wait("join")
    assert ui.card_names() == ["빈1", "빈2"]
    ui.page.click("#join-next")  # 다시 눌러도 이름이 겹쳐 막히지 않는다
    ui.wait("review")
    ui.page.click("#review-next")  # 이름이 있고 수업이 0개여도 추가는 가능
    ui.wait("review")
    assert ui.members() == ["재호", "민지", "빈1"]
    ui.page.click("#review-back")  # 두 번째 장에서 취소해도 추가된 빈1은 카드에서 빠져 있다
    ui.wait("join")
    assert ui.card_names() == ["빈2"]


def test_friend_review_skip_and_finish(ui, blank_capture):
    ui.solo_start()
    ui.add_me()
    ui.open_friend_upload([blank_capture, blank_capture])
    ui.fill_cards(["가", "나"])
    ui.page.click("#join-next")
    ui.wait("review")
    ui.page.click(".review-head button")  # 건너뛰기
    assert "(2/2)" in ui.page.inner_text("#review-panel h2")
    assert ui.page.inner_text("#review-next") == "추가"
    ui.page.fill("#review-name", "나")
    ui.page.click("#review-next")
    ui.wait("solo")
    assert ui.members() == ["재호", "나"]
    assert ui.path == "/?view=solo"


def test_solo_limit_and_error_messages(ui, tmp_path):
    ui.solo_start()
    ui.add_me()
    ui.page.evaluate("for (let i = 0; i < 17; i++) state.solo.members.push({name: '친구' + i, classes: []}); renderSolo()")
    ui.open_friend_upload([CAPTURES["minji"], CAPTURES["seojun"], CAPTURES["yuna"]])  # 남은 자리는 2
    assert ui.page.locator(".friend-card").count() == 2
    assert "20명까지" in ui.page.inner_text("#join-error")
    ui.page.click("#join-cancel")
    ui.wait("solo")

    ui.page.evaluate("state.solo.members.length = 1; renderSolo()")  # 다시 재호만
    txt = tmp_path / "x.txt"
    txt.write_text("hello")
    ui.open_friend_upload(str(txt))  # 이미지가 아닌 파일은 확인 화면에서 직접 입력하도록 안내
    ui.fill_cards(["글자"])
    ui.page.click("#join-next")
    ui.wait("review")
    assert "이미지 파일이 아니에요" in ui.page.inner_text("#review-panel")


def test_solo_result_image_download(ui):
    ui.solo_start()
    ui.add_me(capture="jaeho")
    ui.open_friend_upload([CAPTURES["jaeho"]])
    ui.fill_cards(["민지"])
    ui.page.click("#join-next")
    ui.wait("solo")
    ui.page.wait_for_selector(".save-image")
    with ui.page.expect_download() as dl:
        ui.page.click(".save-image")
    assert dl.value.suggested_filename == "gonggang-result.png"


# ---- 뒤로가기 (History API) ----------------------------------------------------------------
def test_history_home_solo_and_upload_steps(ui):
    ui.open("/")
    ui.page.click("#solo-start")
    ui.wait("solo")
    assert ui.path == "/?view=solo"
    ui.page.go_back()
    ui.wait("home")
    assert ui.path == "/"
    ui.page.go_forward()
    ui.wait("solo")

    ui.add_me(finish=False)  # 올리기 -> 확인
    assert ui.path == "/?view=solo"
    ui.page.go_back()
    ui.wait("join")
    ui.page.go_back()
    ui.wait("solo")
    ui.page.go_back()
    ui.wait("home")

    ui.page.click("#solo-start")  # 추가를 끝낸 뒤 뒤로가기는 첫 화면 (올리기·확인 화면 아님)
    ui.wait("solo")
    ui.add_me()
    assert ui.page.inner_text("#solo-sub") == "1명 추가됨"
    ui.page.go_back()
    ui.wait("home")
    ui.page.go_forward()
    ui.wait("solo")
    assert ui.page.inner_text("#solo-sub") == "1명 추가됨"  # 목록 유지
    ui.page.reload()
    ui.wait("solo")
    assert ui.page.locator("#solo-people li").count() == 0  # 새로고침하면 사라진다


def test_history_group_popup_and_reload_on_review(ui, base_url):
    ui.open("/")
    ui.page.click("#create-group")
    ui.wait("group")
    gid = ui.page.evaluate("new URLSearchParams(location.search).get('g')")
    assert gid
    ui.page.go_back()
    ui.wait("home")
    ui.page.go_forward()
    ui.wait("group")

    ui.page.click("#my-action button")
    ui.wait("join")
    ui.page.fill("#join-name", "재호")
    ui.page.set_input_files("#join-file", CAPTURES["jaeho"])
    ui.page.click("#join-next")
    ui.page.wait_for_selector("#step-review:not([hidden]) .class-row")
    ui.page.click("#review-next")
    ui.wait("group")
    classes = json.load(open(os.path.join(DEMO, "jaeho.json")))["classes"]
    post_group(base_url, {"action": "save", "group_id": gid, "name": "민지", "classes": [{**c, "color": "#f28c8c"} for c in classes]})
    ui.page.reload()
    ui.wait("group")
    ui.page.wait_for_selector(".tt-block.slot")

    for close in ("back", "x", "esc"):  # 팝업은 어떻게 닫아도 기록이 깔끔하다
        ui.page.click(".tt-block.slot >> nth=0")
        ui.page.wait_for_selector(".modal")
        if close == "back":
            ui.page.go_back()
        elif close == "x":
            ui.page.click(".modal-close")
        else:
            ui.page.keyboard.press("Escape")
        ui.page.wait_for_timeout(300)
        assert ui.page.locator(".modal").count() == 0 and ui.visible("group")
        if close != "back":
            ui.page.go_back()  # 팝업을 닫은 뒤의 뒤로가기는 홈
            ui.wait("home")
            ui.page.go_forward()
            ui.wait("group")

    ui.page.click("#my-action button")  # 확인 화면에서 새로고침하면 그룹 화면으로
    ui.wait("join")
    ui.page.fill("#join-name", "재호")
    ui.page.set_input_files("#join-file", CAPTURES["jaeho"])
    ui.page.click("#join-next")
    ui.page.wait_for_selector("#step-review:not([hidden]) .class-row")
    ui.page.reload()
    ui.wait("group")
    assert not ui.visible("review")


def test_image_popup_closes_with_back_on_touch(browser, base_url):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    gid = post_group(base_url, {"action": "create", "name": "터치"})["group_id"]
    classes = json.load(open(os.path.join(DEMO, "jaeho.json")))["classes"]
    for name in ("재호", "민지"):
        post_group(base_url, {"action": "save", "group_id": gid, "name": name, "classes": [{**c, "color": "#f28c8c"} for c in classes]})
    page.goto(base_url + "/")
    page.goto(base_url + f"/?g={gid}")
    page.wait_for_selector(".save-image")
    page.tap(".save-image")  # 터치 기기: 공유 시트가 없으면 이미지를 띄운다
    page.wait_for_selector(".image-card img")
    page.go_back()
    page.wait_for_timeout(300)
    assert page.locator(".modal").count() == 0 and page.is_visible("#step-group")
    ctx.close()
