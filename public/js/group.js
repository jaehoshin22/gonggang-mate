'use strict';

// 그룹 기능: 링크 만들기, 불러오기, 공유, 새로고침, 내 시간표 저장.

// =============================================================================
// 그룹: 링크를 카톡방에 공유 -> 각자 자기 시간표를 올림 -> 자동 비교
// =============================================================================
const groupLink = (gid) => `${location.origin}/?g=${gid}`;

async function createGroup() {
  const btn = $('#create-group');
  const errBox = $('#home-error');
  btn.disabled = true;
  errBox.hidden = true;
  try {
    const data = await postJSON('/api/group', { action: 'create', name: $('#group-name').value });
    state.mode = 'group';
    $('#join-name').value = '';
    state.group = { id: data.group_id, name: '', members: [] };
    await loadGroup();
    go('group');
  } catch (err) {
    errBox.textContent = errText(err);
    errBox.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function loadGroup(silent = false) {
  const gid = state.group.id;
  try {
    const data = await api(`/api/group?g=${encodeURIComponent(gid)}`);
    state.group = data.group;
    state.group.loadedAt = new Date();
    state.group.error = null;
    const members = state.group.members;
    state.result = members.length >= 2 ? await postJSON('/api/free', {
      members: members.map((m) => ({ name: m.name, classes: m.classes.map(({ day, start, end }) => ({ day, start, end })) })),
    }) : null;
  } catch (err) {
    if (!silent) state.group.error = errText(err);
  }
  if (state.step === 'group') renderGroup();
}

// 이 기기에서 올린 내 이름 (그룹에 아직 있을 때만)
function myName() {
  const mine = getMine(state.group.id);
  const me = mine && state.group.members.find((m) => m.id === mine.memberId);
  return me ? me.name : null;
}

async function shareLink(e) {
  const link = groupLink(state.group.id);
  const lbl = e.currentTarget.querySelector('.lbl');
  if (navigator.share) {
    navigator.share({ title: '공강메이트', text: `${state.group.name || '공강 그룹'} 공강 맞추기`, url: link }).catch(() => {});
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    lbl.textContent = '링크를 복사했어요';
  } catch {
    window.prompt('링크를 복사해 주세요', link);
  }
  setTimeout(() => { lbl.textContent = '링크 공유'; }, 2000);
}

const shareButton = (cls) => el('button', { class: cls, type: 'button', onclick: shareLink }, [icon('share', 16), el('span', { class: 'lbl', text: '링크 공유' })]);

function renderGroup() {
  const g = state.group;
  const me = myName();

  $('#group-head').replaceChildren(
    el('div', {}, [
      el('h2', { text: g.name || '공강 그룹' }),
      el('p', { class: 'sub', text: `${g.members.length}명 참여` }),
    ]),
    el('div', { class: 'head-actions' }, [
      refreshButton(),
      shareButton('btn btn-ghost btn-small btn-icon'),
    ]),
  );

  // 참여한 사람 목록 (혼자 비교하기와 같은 이름표, 이 기기에서 올린 내 이름에는 '나')
  const mine = getMine(g.id);
  $('#group-people').replaceChildren(...g.members.map((m) => el('li', {}, [
    m.name,
    mine && m.id === mine.memberId ? el('span', { class: 'sub', text: '나' }) : null,
  ])));

  $('#my-action').replaceChildren(el('button', {
    class: `btn ${me ? 'btn-ghost' : 'btn-primary'}`, type: 'button',
    text: me ? `${me} 시간표 다시 올리기` : '내 시간표 올리기',
    onclick: () => { state.mode = 'group'; state.joinFile = null; go('join'); },
  }));

  const panel = $('#group-result');
  if (g.error) {
    panel.replaceChildren(el('p', { class: 'error-text', text: g.error }));
  } else if (g.members.length < 2 || !state.result) {
    panel.replaceChildren(g.members.length
      ? el('div', { class: 'empty-box' }, [
        el('strong', { text: `지금 ${g.members.length}명 참여 중` }),
        el('p', { text: '한 명만 더 올리면 같이 비는 시간이 보여요' }),
        shareButton('btn btn-primary btn-small btn-icon'),
      ])
      : el('div', { class: 'empty-box' }, [
        el('strong', { text: '아직 아무도 없어요' }),
        el('p', { text: '내 시간표를 먼저 올려 보세요' }),
      ]));
  } else {
    renderResult(panel, state.result, me, g.name || '공강 그룹');
  }
}

// 새로고침 버튼 (자동 갱신은 15초마다 따로 돈다)
const REFRESH_ICON = '<svg width="18" height="18" aria-hidden="true"><use href="img/icons.svg#rotate-cw"/></svg>';
let refreshing = false;
function refreshButton() {
  const btn = el('button', { class: `icon-round${refreshing ? ' spin' : ''}`, type: 'button', 'aria-label': '새로고침', title: '새로고침' });
  btn.innerHTML = REFRESH_ICON;
  btn.addEventListener('click', async () => {
    if (refreshing) return;
    refreshing = true;
    btn.classList.add('spin');
    await Promise.all([loadGroup(), new Promise((r) => setTimeout(r, 500))]);
    refreshing = false;
    renderGroup();
  });
  return btn;
}

async function saveToGroup() {
  const d = state.draft;
  const problem = validateDraft();
  if (problem) return showProblem(problem);
  const gid = state.group.id;
  const mine = getMine(gid);
  const btn = $('#review-next');
  btn.disabled = true;
  btn.textContent = '저장 중...';
  try {
    const data = await postJSON('/api/group', {
      action: 'save',
      group_id: gid,
      member_id: mine ? mine.memberId : null,
      name: d.name.trim(),
      classes: d.classes.map(({ day, start, end, color }) => ({ day, start, end, color })),
    });
    setMine(gid, { memberId: data.member_id, name: d.name.trim() });
    $('#join-name').value = '';
    await loadGroup();
    finishFlow('group');
  } catch (err) {
    // 같은 이름은 이 기기에서 올린 본인 것만 다시 올릴 수 있다(member_id). 그 밖에는 이름을 바꾸게 한다
    if (err.code === 'NAME_TAKEN') {
      showProblem({ field: 'name', message: dupNameMessage(d.name.trim()) });
    } else showReviewError(errText(err));
  } finally {
    btn.disabled = false;
    btn.textContent = '그룹에 저장';
  }
}
