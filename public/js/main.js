'use strict';

// 시작점: 버튼 이벤트를 연결하고, 주소를 보고 첫 화면을 정한다. 가장 마지막에 불러온다.

// ---- 이벤트 연결 -----------------------------------------------------------
$('#create-group').addEventListener('click', createGroup);
$('#join-file').addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  e.target.value = '';
  if (state.mode === 'solo' && state.solo.adding === 'friend') {
    const note = addCards(files);
    renderJoin();
    if (note) { $('#join-error').textContent = note; $('#join-error').hidden = false; }
    return;
  }
  state.joinFile = files[0] || null;
  renderJoin();
});
$('#join-next').addEventListener('click', joinParse);
$('#join-cancel').addEventListener('click', () => history.back());
$('#review-back').addEventListener('click', () => history.back());
$('#review-next').addEventListener('click', () => (state.mode === 'solo' ? addToSolo() : saveToGroup()));
$('#solo-start').addEventListener('click', startSolo);

// ---- 시작: 주소를 보고 화면을 정한다 (?g= 그룹, ?view=solo 혼자 비교하기, 그 외 첫 화면) ----
(async function start() {
  const step = stepFromUrl();
  if (step === 'solo') state.mode = 'solo';
  history.replaceState({ step, mode: state.mode }, '', location.href);
  if (step !== 'group') {
    show(step);
    return;
  }
  state.group = { id: new URLSearchParams(location.search).get('g'), name: '', members: [] };
  show('group');
  await loadGroup();
})();
