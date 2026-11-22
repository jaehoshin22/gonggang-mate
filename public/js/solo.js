'use strict';

// 혼자 비교하기: 서버에 저장하지 않고 이 화면에서만 여러 명을 비교한다.

// =============================================================================
// 혼자 비교하기: 저장 없이 이 화면에서만 (새로고침하면 사라짐). 결과는 이미지로 저장
// =============================================================================
function startSolo() {
  state.mode = 'solo';
  go('solo');
}

async function computeSolo() {
  const { members } = state.solo;
  state.solo.error = null;
  if (members.length < 2) {
    state.solo.result = null;
    return;
  }
  try {
    state.solo.result = await postJSON('/api/free', { members: members.map(({ name, classes }) => ({ name, classes })) });
  } catch (err) {
    state.solo.result = null;
    state.solo.error = errText(err);
  }
}

const soloMe = () => state.solo.members.find((m) => m.me) || null;

function openSoloUpload(who) {
  state.mode = 'solo';
  state.solo.adding = who;
  state.joinFile = null;
  clearCards();
  $('#join-name').value = '';
  go('join');
}

function renderSolo() {
  const { members, result, error } = state.solo;
  const me = soloMe();
  const friends = members.filter((m) => !m.me).length;
  $('#solo-sub').textContent = `${members.length}명 추가됨`;
  $('#solo-sub').hidden = !members.length;

  // 내 시간표를 잘못 올렸으면 로고를 눌러 처음부터 다시 한다 (여기서는 바꾸거나 빼지 않는다)
  const actions = [];
  if (!me) {
    actions.push(el('button', { class: 'btn btn-primary', type: 'button', text: '내 시간표 올리기', onclick: () => openSoloUpload('me') }));
  } else {
    actions.push(el('button', {
      class: `btn ${friends ? 'btn-ghost' : 'btn-primary'}`, type: 'button',
      text: '친구 시간표 추가', disabled: members.length >= SOLO_MAX, onclick: () => openSoloUpload('friend'),
    }));
  }
  $('#solo-action').replaceChildren(...actions);

  $('#solo-people').replaceChildren(...members.map((m, i) => el('li', {}, [
    m.name,
    m.me ? el('span', { class: 'sub', text: '나' }) : null,
    // 내 시간표는 빼지 않고 '다시 올리기'로 바꾼다
    m.me ? null : el('button', {
      type: 'button', 'aria-label': `${m.name} 빼기`, title: '빼기',
      onclick: async () => { members.splice(i, 1); await computeSolo(); renderSolo(); },
    }, [icon('x', 14)]),
  ])));

  const panel = $('#solo-result');
  if (error) {
    panel.replaceChildren(el('p', { class: 'error-text', text: error }));
  } else if (members.length < 2 || !result) {
    panel.replaceChildren(el('div', { class: 'empty-box' }, me ? [
      el('strong', { text: '친구 시간표를 추가해 보세요' }),
      el('p', { text: '2명 이상이면 같이 비는 시간이 보여요' }),
    ] : [
      el('strong', { text: '내 시간표를 올려 보세요' }),
      el('p', { text: '친구 시간표를 더하면 같이 비는 시간이 보여요' }),
    ]));
  } else {
    renderResult(panel, result, me ? me.name : null, '같이 비는 공강', '화면을 나가면 결과가 사라져요. 필요하면 이미지로 저장해 두세요.');
  }
}

async function addToSolo() {
  const d = state.draft;
  const problem = validateDraft();
  if (problem) return showProblem(problem);
  const name = d.name.trim();
  const { members, adding } = state.solo;
  const mine = adding === 'me';
  const others = members.filter((m) => !(mine && m.me)); // 내 시간표를 다시 올릴 때는 옛 내 시간표를 뺀 나머지와 비교
  if (others.some((m) => m.name === name)) return showProblem({ field: 'name', message: dupNameMessage(name) });
  if (!mine && members.length >= SOLO_MAX) return showReviewError(`한 번에 ${SOLO_MAX}명까지 비교할 수 있어요.`);
  const btn = $('#review-next');
  btn.disabled = true;
  btn.textContent = '비교 중...';
  const entry = { name, classes: d.classes.map(({ day, start, end }) => ({ day, start, end })) };
  if (mine) {
    const at = members.findIndex((m) => m.me);
    if (at >= 0) members[at] = { ...entry, me: true };
    else members.unshift({ ...entry, me: true });
  } else {
    members.push(entry);
  }
  state.joinFile = null;
  $('#join-name').value = '';
  await computeSolo();
  btn.disabled = false;
  if (!mine && d.cardId) removeCard(d.cardId);
  if (!mine && nextInQueue()) return;
  finishFlow('solo');
}

// 여러 장을 한꺼번에 올렸다면 다음 장의 확인 화면으로 (없으면 false)
function nextInQueue() {
  const q = state.queue;
  if (!q || state.queueIndex >= q.length - 1) return false;
  state.queueIndex += 1;
  state.draft = q[state.queueIndex];
  renderReview();
  window.scrollTo(0, 0);
  return true;
}

function skipDraft() {
  if (state.draft && state.draft.cardId) removeCard(state.draft.cardId);
  if (!nextInQueue()) finishFlow('solo');
}
