# 공강메이트

에브리타임 시간표 캡처 여러 장을 올리면, 모두가 함께 비는 공강 시간을 찾아주는 모바일 웹앱.

## 실행

```bash
pip install -r requirements.txt pytest
python tools/make_samples.py   # 시연용 합성 캡처 4장 (samples/demo)
python dev_server.py           # http://localhost:8000
```

같은 와이파이의 휴대폰에서는 `http://<PC의 IP>:8000` 으로 접속한다.

## 테스트와 측정

```bash
python -m pytest               # 단위 테스트 (공강 계산, 이미지 인식, API)
python tools/evaluate.py samples/real   # 실제 캡처 정확도·속도 측정 (비기능 요구사항)
```

`samples/real/` 에 실제 캡처 `이름.png` 와 정답 `이름.json` 을 같이 둔다. 정답 형식은 `samples/demo/*.json` 참고.

## 배포 (Vercel)

1. GitHub에 올리고 Vercel에서 저장소를 Import (Framework: Other)
2. `vercel.json` 설정대로 `public/` 은 정적 파일, `api/*.py` 는 Python 함수가 된다.
3. 첫 배포 후 `/api/parse` 가 `ModuleNotFoundError: core` 를 내면 `vercel.json` 의 `includeFiles` 설정을 확인한다.

## 구조

```
public/            화면 (HTML, CSS Grid, 바닐라 JS)
  app.js           업로드(F3) → 확인·수정(F2) → 공강 결과(F4~F6)
api/parse.py       POST /api/parse  캡처 한 장 → 수업 목록
api/free.py        POST /api/free   멤버 시간표들 → 공통 공강·차선 시간
core/parser.py     이미지 인식 (Pillow, 규칙 기반)
core/free.py       공강 계산 (5분 칸 108개, AND 연산)
core/web.py        요청/응답 처리 (Vercel 함수와 dev_server 공용)
tests/             pytest (tests/synth.py 가 합성 캡처 생성)
tools/             시연 샘플 생성, 정확도 측정
```

## API

`POST /api/parse` — 본문은 이미지 바이트 그대로 (4MB 이하, 넘으면 브라우저에서 JPEG로 다시 저장)

```json
{"ok": true,
 "classes": [{"day": "MON", "start": "09:00", "end": "10:15", "color": "#f28c8c"}],
 "warnings": [{"code": "grid_ends_early", "message": "..."}],
 "meta": {"days": ["MON","TUE","WED","THU","FRI"], "grid_start": "09:00", "grid_end": "18:00", "px_per_hour": 120.0}}
```

실패 시 `{"ok": false, "error": {"code": "not_timetable", "message": "..."}}`
(`empty`, `not_image`, `not_timetable`, `dark_mode`, `too_large`)

`POST /api/free`

```json
{"members": [{"name": "재호", "classes": [{"day": "MON", "start": "09:00", "end": "10:15"}]}],
 "min_minutes": 60}
```

응답의 `common` 은 전원이 비는 구간, `partial` 은 정확히 한 명만 빠지는 구간(3명 이상일 때)이다.

## 정해 둔 규칙

- 공강 범위는 09:00~18:00 고정, 월~금만 계산한다.
- 수업이 없는 요일은 그 사람이 비어 있는 것으로 계산한다.
- 인식한 시각은 5분 단위로 맞추고, 수업 길이가 75·150·180분에 10분 이내로 가까우면 그 값으로 맞춘다.
- 캡처 맨 위 가로 눈금을 09:00으로 본다. 위로 스크롤된 캡처는 확인 화면의 '캡처 맨 위 시각'으로 한 번에 옮긴다.
- 격자가 18시 전에 끝나면(아래가 가려짐) 경고하고, 그 시간대는 사용자가 직접 확인·추가한다.
- 이미지는 메모리에서만 처리하고 저장하지 않는다.

## 실제 캡처로 조정할 값

인식 기준값은 `core/parser.py` 맨 위 상수에 모여 있다. 지금 값은 합성 캡처 기준이므로, 실제 캡처에서 틀리면 아래 순서로 확인한다.

| 증상 | 조정할 상수 |
|------|-------------|
| `not_timetable` (격자를 못 찾음) | `GRAY_MIN_VAL`, `GRAY_MAX_VAL`, `H_LINE_MIN_RATIO` |
| 요일 칸 수가 틀림 | `V_LINE_MIN_RATIO` |
| 연한 색 수업을 놓침 | `BLOCK_MIN_SAT` 낮추기 |
| 수업 하나가 둘로 쪼개짐 | `GAP_FILL_HOURS` 올리기, `HUE_SPLIT` 올리기 |
| 붙은 두 수업이 하나로 합쳐짐 | `HUE_SPLIT` 낮추기 |
| 시각이 한 시간씩 밀림 | 헤더 선이 눈금으로 잡힘 → `_regular_run` 결과 확인 |
