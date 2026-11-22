"""공강메이트 서버 핵심 로직 (Vercel 에서 실행되는 파이썬 쪽).

handlers   요청 검사와 예외 -> 상태 코드 변환   (현업의 handler/controller)
parser     시간표 이미지 인식                    (서비스)
free       같이 비는 시간 계산                   (서비스)
group      그룹·이름 규칙                        (서비스)
store      Supabase 저장·조회                    (repository)
time_utils 시각 문자열 <-> 분 변환, 요일 상수     (공통 도구)
"""
