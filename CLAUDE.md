# 공강메이트

그룹 링크를 카톡방에 공유하면 각자 에브리타임 시간표 캡처를 올리고, 수업과 수업 사이에 같이 비는 시간(공강)을 주간 시간표에 이름으로 보여 주는 모바일 웹.
캡스톤 과제 (SKHU 소프트웨어융합학부 신재호, VSCode + GitHub Copilot 활용 실무 프로그래밍).

## 작업 규칙

- 답변, 커밋 메시지, 코드 주석, UI 문구는 한국어로 쓴다.
- 이모지는 어디에도 쓰지 않는다 (답변, 코드, UI 문구 모두).
- 기능 범위는 아래 "기능 범위"만이다. 범위 밖 기능은 사용자가 요청하기 전에 추가하지 않는다.
- 코드를 바꾸면 `python -m pytest -q`가 통과하는지 확인한 뒤 끝낸다.
- 커밋 작성자: 신재호 <tlswogh2014@gmail.com>. push는 사용자가 확인한 뒤에 한다.
- 비밀 키(Supabase secret key)는 코드, 커밋, 대화에 절대 넣지 않는다. Vercel 환경 변수에만 둔다.
- `samples/real/`(친구들 실제 캡처와 정답 JSON)은 개인정보라서 gitignore 대상이다. 커밋하지 않는다.

## 실행

```
pip install -r requirements.txt pytest
python dev_server.py          # http://localhost:8000 (메모리 저장소, Supabase 없이 동작)
python -m pytest -q           # 테스트
python tools/evaluate.py samples/real   # 실제 캡처 인식 정확도 측정 (로컬 전용)
```

## 구조

```
public/            프론트엔드 (빌드 없는 vanilla JS): index.html, app.js, style.css
api/*.py           Vercel 서버리스 함수 (BaseHTTPRequestHandler의 handler 클래스)
  parse.py         POST 이미지 -> 수업 목록
  free.py          POST 멤버 시간표 -> 같이 비는 공강
  group.py         GET/POST 그룹 만들기, 조회, 내 시간표 저장
core/              실제 로직 (api와 dev_server가 같이 씀)
  parser.py        시간표 캡처 인식 (규칙 기반 픽셀 분석, OCR/AI 없음)
  free.py          공강 계산
  group.py         그룹 요청 검증과 처리
  store.py         SupabaseStore (PostgREST RPC) / MemoryStore
  web.py           요청·응답 공통 처리
  timeutil.py      요일, 시각 변환
supabase/schema.sql  테이블, RLS, RPC 함수 (Supabase SQL Editor에서 실행)
tests/             pytest (tests/synth.py가 합성 시간표 이미지를 만든다)
dev_server.py      로컬 개발 서버
```

## 기능 범위 (MVP 기획서 기준)

화면은 세 개뿐이다.

1. 첫 화면: 그룹 이름(선택) 입력 -> 그룹 만들기 -> `/?g=<uuid>` 링크
2. 업로드·수정: 이름 입력 + 캡처 1장 -> 인식 -> 확인·수정 화면 (이름, 미리보기, 수업 추가/수정/삭제) -> 그룹에 저장
   - 인식에 실패하면 빈 수정 화면에서 직접 입력한다.
   - "캡처 맨 위 시각" 선택은 인식 경고가 있을 때만 보인다.
   - 다시 올리면 기존 시간표를 덮어쓴다 (삭제 기능은 없음).
3. 그룹 결과 (메인): 그룹 이름, N명 참여, 링크 공유 버튼, 내 시간표 올리기 버튼, 필터, 주간 시간표
   - 필터: 인원 2명 이상 / 3명 이상 / 전원, 시간 30분 / 1시간 / 2시간 이상 (기본 2명, 30분)
   - 각 칸에 같이 비는 사람 이름을 텍스트로 나열한다.
   - 색은 "나" 강조에만 쓴다: 내가 포함된 칸 = 연한 파랑 배경 + 내 이름 맨 위 굵게, 나머지 칸 = 회색으로 약하게. 사람별 색은 없다.
   - 칸을 누르면 상세 팝업: 요일, 시작-종료, 길이, 인원, 이름
   - 15초마다 자동 갱신

넣지 않는 것: 여러 장 모아서 혼자 비교, 친구별 조합 탐색(토글), 공강 목록, 사람별 색, 채팅, 투표, 알림, 랭킹, 통계, 원본 확대, 학기 확인 안내.

## 정해진 규칙

- 공강 = 각자 그날 첫 수업 시작부터 마지막 수업 끝 사이의 빈 시간. 첫 수업 전, 마지막 수업 후는 공강이 아니다.
- 수업이 없거나 하나뿐인 요일은 그 사람이 학교에 오지 않은 것으로 보고 공강이 없다.
- 계산은 5분 단위(하루 288칸), 화면 눈금은 30분. 학교 수업은 50분, 1시간 15분, 2시간 50분 단위라 10:15, 14:50처럼 끝난다. 30분 단위로 계산하지 않는다.
- 2명 이상 같이 비는 시간만 표시한다. 30분 미만은 서버에서 제외한다.
- 연속된 시간은 같이 비는 사람 조합이 똑같을 때만 한 칸으로 묶는다 (`core/free.py`의 segments).
- 그리드 기본 범위는 9~18시, 블록이 벗어나면 정시 단위로 늘린다.
- "나" 식별: 로그인 없이 localStorage `gongang:group:<gid>` = {memberId, name}.
- 같은 이름이 이미 있으면 NAME_TAKEN -> "내가 그 사람이에요(claim)" 또는 "이름 바꾸기"를 선택한다.
- 그룹 최대 20명, 이름 20자, 수업 60개, 이미지 4MB (넘으면 브라우저에서 JPEG로 다시 저장).

## 시간표 인식 (core/parser.py)

- 라이트/다크 자동 판별, 회색 그리드 선, 정시 선 간격으로 시간당 픽셀 계산, 블록 HSV 마스크, 시작·종료 5분 스냅.
- 수업 길이는 보정하지 않는다 (알바, 근로 같은 개인 일정도 있음).
- 실제 캡처 10장(iPhone, 카톡 압축 포함) 정확도 94/94. 인식을 바꾸면 `tools/evaluate.py`로 다시 확인한다.
- 경고: grid_ends_early, block_cut, few_days. 에러: empty, not_image, not_timetable.

## 배포

- Vercel: https://gonggang-mate-chi.vercel.app (GitHub main에 push하면 자동 배포)
- GitHub(공개): https://github.com/jaehoshin22/gonggang-mate
- 환경 변수: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (sb_secret_ 키는 apikey 헤더만, eyJ 키는 Authorization도)
- `vercel.json`: outputDirectory=public, api 함수에 core/** 포함
- Supabase `delete_member` 함수는 더 이상 쓰지 않지만 DB에 남아 있다.
