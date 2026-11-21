"""화면 테스트(tests/e2e)는 브라우저가 필요해서 기본으로는 건너뛴다.

실행: python -m pytest tests/e2e --e2e -q
준비: pip install playwright pytest && python -m playwright install chromium
(크롬이 이미 있으면 환경변수 E2E_CHROME 에 실행 파일 경로를 적어도 된다)
"""

import pytest


def pytest_addoption(parser):
    parser.addoption("--e2e", action="store_true", default=False, help="브라우저 화면 테스트(tests/e2e) 실행")


def pytest_collection_modifyitems(config, items):
    if config.getoption("--e2e"):
        return
    skip = pytest.mark.skip(reason="화면 테스트는 --e2e 를 붙여야 실행돼요 (tests/conftest.py 참고)")
    for item in items:
        if "e2e" in item.nodeid.split("/"):
            item.add_marker(skip)
