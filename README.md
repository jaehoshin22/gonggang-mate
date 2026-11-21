# 공강메이트

에브리타임 시간표 캡처로 친구들과 함께 비는 공강 시간을 찾아주는 모바일 웹앱.

- **그룹 링크 (F7):** 그룹을 만들어 카톡방에 링크를 올리면, 각자 자기 시간표 캡처를 올리는 대로 공통 공강이 자동으로 보인다.
- **혼자 비교하기:** 링크 없이 내 시간표와 친구 캡처 여러 장을 올려 바로 비교한다. 서버에 저장하지 않고, 화면을 나가면 사라진다.
- **결과 이미지 저장:** 그룹과 혼자 비교하기의 결과를 이미지(PNG)로 저장하거나 공유한다.

## 실행

```bash
pip install -r requirements.txt pytest
python tools/make_samples.py   # 시연용 합성 캡처 4장 (samples/demo)
python dev_server.py           # http://localhost:8000
```

같은 와이파이의 휴대폰에서는 `http://<PC의 IP>:8000` 으로 접속한다.

모든 화면을 폰 크기로 나란히 보려면 서버를 켠 채 `http://localhost:8000/_screens` 를 연다. `public/` 의 파일을 저장하면 자동으로 다시 불러온다. 화면을 더 넣으려면 `dev/screens.html` 의 `SCENES` 에 한 줄을 추가한다. 개발용이라 배포(`public/`)에는 포함되지 않는다.

## 테스트와 측정

```bash
python -m pytest               # 단위 테스트 (공강 계산, 이미지 인식, API, 그룹)
pip install playwright && python -m playwright install chromium
python -m pytest tests/e2e --e2e   # 화면 흐름 테스트 (E2E_CHROME 으로 크롬 경로 지정 가능)
# 그룹 SQL까지 실제 PostgreSQL로 검증하려면 (psycopg 필요)
PG_TEST_DSN="host=localhost user=postgres dbname=postgres" python -m pytest tests/test_group.py
python tools/evaluate.py samples/real   # 실제 캡처 정확도·속도 측정 (비기능 요구사항)
```

`samples/real/` 에 실제 캡처 `이름.png` 와 정답 `이름.json` 을 같이 둔다. 정답 형식은 `samples/demo/*.json` 참고.

## 배포 (Vercel)

1. GitHub에 올리고 Vercel에서 저장소를 Import (Framework: Other)
2. `vercel.json` 설정대로 `public/` 은 정적 파일, `api/*.py` 는 Python 함수가 된다.
3. 첫 배포 후 `/api/parse` 가 `ModuleNotFoundError: core` 를 내면 `vercel.json` 의 `includeFiles` 설정을 확인한다.

## 그룹 기능 설정 (Supabase)

1. supabase.com 에서 새 프로젝트를 만든다 (Region: Northeast Asia (Seoul)).
2. SQL Editor 에 `supabase/schema.sql` 전체를 붙여 넣고 Run.
3. 두 값을 복사한다.
   - Project URL (`https://xxxx.supabase.co`)
   - Secret key (`sb_secret_...`). 예전 프로젝트라면 Legacy 탭의 `service_role` 키도 동작한다.
     **브라우저 코드나 GitHub에 절대 넣지 않는다.**
4. Vercel → 프로젝트 → Settings → Environment Variables 에 추가하고 다시 배포한다.
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_KEY` = Secret key (`sb_secret_...`)
5. 로컬에서는 환경변수가 없으면 메모리에 저장한다 (`python dev_server.py`, 서버를 끄면 사라짐).

### 데이터 구조 (10주차 SQL)

```
groups (id, name, created_at)
  └─ members (id, group_id → groups, name, updated_at)   UNIQUE(group_id, name)
       └─ classes (id, member_id → members, day, start_time, end_time, color)
```

- `get_group(그룹ID)`: `groups LEFT JOIN members LEFT JOIN classes` 로 그룹 전체를 한 번에 조회
- `save_member(...)`: 멤버 추가·수정과 수업 목록 교체를 한 트랜잭션으로 처리. 같은 이름이면 `NAME_TAKEN`
- `delete_old_groups(180)`: 180일 지난 그룹 정리
- `delete_member(...)`: 멤버 삭제. 화면에서 멤버를 뺄 수 있게 하지 않아서 현재는 쓰지 않는다.
- 세 테이블 모두 RLS를 켜고 정책을 두지 않아, 공개 키로는 읽고 쓸 수 없다. 서버만 secret 키로 함수를 호출한다.

### 사람 구분 (로그인 없음)

- 그룹은 추측할 수 없는 UUID 링크(`?g=...`)로 구분한다. 링크를 가진 사람만 보고 올릴 수 있다.
- 내가 올린 멤버 ID는 그 기기의 localStorage 에만 기억해서 "내 시간표 다시 올리기"와 결과 화면의 '나' 강조에 쓴다.
- 같은 이름이 이미 있으면 "내가 그 사람이에요(덮어쓰기)" / "다른 사람이에요(이름 바꾸기)"를 묻는다.

## 개인정보

- 캡처 이미지는 인식하는 동안 메모리에서만 쓰고 저장하지 않는다.
- 인식은 글자를 읽는 방식(OCR)이 아니라 색과 위치만 보는 규칙 기반이라, 과목명·교수·강의실은 읽지도 저장하지도 않는다.
- 그룹에 저장하는 것은 이름과 수업 시간대(요일, 시작·끝 시각, 색)뿐이다. 공강을 계산하는 데 꼭 필요한 정보만 남긴다.
- 그룹 링크를 아는 사람은 화면에 보이는 이름·공강 외에도, 서버 응답(`GET /api/group`)에 담긴 각 멤버의 수업 시간대를 볼 수 있다. 화면에는 표시하지 않는다.
- 혼자 비교하기는 서버에 아무것도 저장하지 않는다.
- 그룹은 자동으로 지워지지 않는다. `delete_old_groups(180)`을 실행하면 180일 지난 그룹을 정리한다.

## 구조

```
public/            화면 (HTML, CSS Grid, 바닐라 JS)
  app.js           업로드(F3) → 확인·수정(F2) → 공강 결과(F4~F6), 혼자 비교하기, 결과 이미지 저장,
                   화면 이동은 History API(화면마다 기록 한 칸, 뒤로가기는 popstate)
api/parse.py       POST /api/parse  캡처 한 장 → 수업 목록
api/free.py        POST /api/free   멤버 시간표들 → 공통 공강·차선 시간
api/group.py       GET/POST /api/group  그룹 만들기·조회·내 시간표 저장 (F7)
core/group.py      그룹 요청 검증·처리
core/store.py      Supabase 호출 / 메모리 저장소
supabase/schema.sql  테이블·SQL 함수·권한
core/parser.py     이미지 인식 (Pillow, 규칙 기반)
core/free.py       공강 계산 (5분 칸 288개, 같은 사람 조합이 이어진 구간으로 묶기)
core/web.py        요청/응답 처리 (Vercel 함수와 dev_server 공용)
dev/screens.html   화면 모아보기 (개발용, dev_server 에서만 열림)
tests/             pytest (tests/synth.py 가 합성 캡처 생성)
  e2e/             화면 흐름 Playwright 테스트 (--e2e 로만 실행)
tools/             시연 샘플 생성, 정확도 측정
```

## API

`POST /api/parse` — 본문은 이미지 바이트 그대로 (4MB 이하, 넘으면 브라우저에서 JPEG로 다시 저장)

```json
{"ok": true,
 "classes": [{"day": "MON", "start": "09:00", "end": "10:15", "color": "#f28c8c"}],
 "warnings": [{"code": "grid_ends_early", "message": "..."}],
 "meta": {"theme": "dark", "days": ["MON","TUE","WED","THU","FRI"], "grid_start": "09:00", "grid_end": "18:00", "px_per_hour": 120.0}}
```

실패 시 `{"ok": false, "error": {"code": "not_timetable", "message": "..."}}`
(`empty`, `not_image`, `not_timetable`, `too_large`)

`POST /api/free`

```json
{"members": [{"name": "재호", "classes": [{"day": "MON", "start": "09:00", "end": "10:15"}]}]}
```

응답
- `overlaps`: 같이 비는 공강 목록. 항목마다 `names`(되는 사람), `everyone`(전원 여부). 많은 사람이 겹치는 순서
- `segments`: 그리드 표시용으로 같은 사람들이 겹치는 구간 (서로 겹치지 않음)
- `everyone_count`: 전원이 비는 공강 수

`GET /api/group?g=<그룹ID>` → `{"ok": true, "group": {"id", "name", "members": [{"id", "name", "classes"}]}}`

`POST /api/group`
- `{"action": "create", "name": "소융 밥약"}` → `group_id`
- `{"action": "save", "group_id", "member_id"(수정 시), "name", "classes", "claim"(같은 이름 덮어쓰기, 화면에서는 쓰지 않음)}` → `member_id`

오류 코드: `GROUP_NOT_FOUND`(404), `NAME_TAKEN`(409), `GROUP_FULL`(409, 20명), `not_configured`(503, 환경변수 없음)

## 정해 둔 규칙

- 공강 = 각자 그날 **첫 수업 시작부터 마지막 수업 끝 사이**의 빈 시간. 첫 수업 전·마지막 수업 후는 세지 않는다.
- 수업이 없거나 하나뿐인 날은 그 사람에게 공강이 없다(학교에 오지 않음). 월~금만 계산한다.
- 2명 이상이 같이 비는 시간을 모두 보여 주고, 그때 되는 사람 이름을 적는다. 30분 미만은 뺀다.
- 라이트모드와 다크모드 캡처를 모두 인식한다.
- 인식한 시각은 5분 단위로만 반올림하고 수업 길이는 보정하지 않는다. 학교 수업(50분, 1시간 15분, 2시간 50분)과 근로·알바·운동 같은 개인 일정의 길이가 제각각이기 때문이다.
- 캡처 맨 위 가로 눈금을 09:00으로 본다. 위로 스크롤된 캡처는 확인 화면의 '캡처 맨 위 시각'으로 한 번에 옮긴다.
- 격자가 17시 전에 끝나면(아래가 가려짐) 경고하고, 그 시간대는 사용자가 직접 확인·추가한다. 에브리타임은 수업이 없어도 17시까지는 보여 주므로 17시에서 끝나는 것은 경고하지 않는다.
- 캡처 이미지는 메모리에서만 처리하고 저장하지 않는다. (아래 개인정보 항목 참고)

## 실제 캡처로 조정할 값

인식 기준값은 `core/parser.py` 맨 위 상수에 모여 있다. 아이폰 실제 캡처 9장(다크 8, 라이트 1, 수업 블록 88개)으로 맞췄다. 다른 기종에서 틀리면 아래 순서로 확인한다.

| 증상 | 조정할 상수 |
|------|-------------|
| `not_timetable` (격자를 못 찾음) | `GRAY_VAL_RANGE`(테마별), `H_LINE_MIN_RATIO` |
| 요일 칸 수가 틀림 | `V_LINE_MIN_RATIO` |
| 연한 색 수업을 놓침 | `BLOCK_MIN_SAT` 낮추기 |
| 수업 하나가 둘로 쪼개짐 | `GAP_FILL_HOURS` 올리기, `HUE_SPLIT` 올리기 |
| 붙은 두 수업이 하나로 합쳐짐 | `HUE_SPLIT` 낮추기 |
| 시각이 한 시간씩 밀림 | 헤더 선이 눈금으로 잡힘 → `_regular_run` 결과 확인 |
| 정각이 아닌 시작 시각이 5분 늦게 나옴 | `BLOCK_TOP_INSET_HOURS` |
