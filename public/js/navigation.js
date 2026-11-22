'use strict';

// 화면 전환과 브라우저 기록(뒤로가기·앞으로가기). 화면 목록은 index.html 의 #step-* 구역.

// ---- 화면 전환 -------------------------------------------------------------
// 화면마다 브라우저 기록을 한 칸씩 남겨서 뒤로가기·앞으로가기가 사이트 안에서 움직이게 한다.
//   첫 화면 /, 그룹 /?g=<id>, 혼자 비교하기 /?view=solo
//   시간표 올리기·확인 화면과 팝업은 주소를 바꾸지 않고 기록만 한 칸 추가
function stepUrl(step) {
  if (step === 'home') return '/';
  if (step === 'solo') return '/?view=solo';
  if (step === 'group') return `/?g=${state.group.id}`;
  return location.pathname + location.search;
}

function stepFromUrl() {
  const params = new URLSearchParams(location.search);
  if (params.get('g')) return 'group';
  if (params.get('view') === 'solo') return 'solo';
  return 'home';
}

// 화면을 넘기고 기록을 한 칸 추가한다
function go(step) {
  const entry = { step, mode: state.mode };
  const url = stepUrl(step);
  if (history.state && history.state.modal) history.replaceState(entry, '', url);
  else history.pushState(entry, '', url);
  show(step);
}

// 올리기·확인 화면 두 칸을 걷어내고 부모 화면으로 (끝낸 뒤 뒤로가기가 확인 화면으로 가지 않게)
function finishFlow(parent) {
  state.draft = null;
  state.joinFile = null;
  clearCards();
  state.queue = null;
  if (history.state && history.state.step === 'review') history.go(-2);
  else go(parent);
}

// 기록은 건드리지 않고 화면만 바꾼다
function show(step) {
  state.step = step;
  removeModal();
  document.body.classList.toggle('home', step === 'home');
  document.querySelectorAll('main > .step').forEach((s) => { s.hidden = s.id !== `step-${step}`; });
  if (step === 'review') renderReview();
  if (step === 'group') renderGroup();
  if (step === 'solo') renderSolo();
  if (step === 'join') renderJoin();
  clearInterval(refreshTimer);
  if (step === 'group') {
    refreshTimer = setInterval(() => { if (!document.hidden && !detail) loadGroup(true); }, REFRESH_MS);
  }
  window.scrollTo(0, 0);
}

// ---- 뒤로가기·앞으로가기: 기록에 남긴 화면으로 되돌린다 ----------------------------
window.addEventListener('popstate', (e) => {
  if (detail) removeModal(); // 팝업이 열려 있으면 뒤로가기는 팝업만 닫는다
  const st = e.state;
  if (st && st.modal) return;
  let step = st && st.step ? st.step : stepFromUrl();
  if (st && st.mode) state.mode = st.mode;
  else if (step === 'solo') state.mode = 'solo';
  if (step === state.step) return;

  if (step === 'group') {
    const gid = new URLSearchParams(location.search).get('g');
    if (gid && (!state.group || state.group.id !== gid)) {
      state.group = { id: gid, name: '', members: [] };
      loadGroup();
    }
  }
  // 새로고침 등으로 인식 결과가 없으면 확인 화면은 열 수 없다: 부모 화면으로
  if (step === 'review' && !state.draft) {
    step = state.mode === 'solo' ? 'solo' : 'group';
    history.replaceState({ step, mode: state.mode }, '', stepUrl(step));
  }
  show(step);
});
