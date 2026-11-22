'use strict';

// 상수와 전역 상태. 다른 파일이 모두 이 값을 읽는다.
// 화면 코드 전체 순서와 역할은 index.html 맨 아래 <script> 목록과 README "구조"를 참고.

// ---- 상수 ----------------------------------------------------------------
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_LABEL = { MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금', SAT: '토', SUN: '일' };
const GRID_START = 9 * 60; // 그리드 기본 범위 (블록이 벗어나면 늘어남)
const GRID_END = 18 * 60;
const MAX_UPLOAD = 4 * 1024 * 1024;
const REFRESH_MS = 15000; // 그룹 화면 자동 새로고침 간격
const SOLO_MAX = 20;      // 혼자 비교하기 최대 인원 (서버 find_overlaps 한도와 같게)
const PALETTE = ['#f28c8c', '#82b4f0', '#8ccda0', '#f5be6e', '#b496e1', '#6ec8c8', '#f0a0c8', '#c8be78'];
const HOUR_PX = 64;      // 결과 그리드 1시간 높이 (style.css .tt.tall --hour 와 같게)
const LINE_PX = 13.6;    // 칸 안 글자 한 줄 높이

// ---- 상태 ----------------------------------------------------------------
const state = {
  step: 'home',
  mode: 'group',    // 'group' (링크로 모으기) | 'solo' (저장 없이 혼자 비교하기)
  solo: { members: [], result: null, error: null, adding: null }, // members: [{name, classes, me?}] me 는 내 시간표(한 명), adding: 지금 올리는 사람 'me'|'friend'
  group: null,      // {id, name, members: [{id, name, classes}]}
  result: null,     // /api/free 응답
  joinFile: null,
  friendCards: [],  // 혼자 비교하기에서 고른 친구 캡처 카드 [{id, file, preview, name}]
  queue: null,      // 여러 장을 인식한 뒤 한 장씩 확인하는 초안 목록
  queueIndex: 0,
  draft: null,      // 확인 화면에서 고치는 내 시간표 {name, status, error, warnings, classes, gridStart}
};
let nextId = 1;
let refreshTimer = null;
