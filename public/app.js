'use strict';

// ---- 상수 ----------------------------------------------------------------
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_LABEL = { MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금', SAT: '토', SUN: '일' };
const GRID_START = 9 * 60;
const GRID_END = 18 * 60;
const MAX_UPLOAD = 4 * 1024 * 1024;
const REFRESH_MS = 15000; // 그룹 화면 자동 새로고침 간격
const PALETTE = ['#f28c8c', '#82b4f0', '#8ccda0', '#f5be6e', '#b496e1', '#6ec8c8', '#f0a0c8', '#c8be78'];
const SOLO_STEPS = ['upload', 'review', 'result'];

// ---- 상태 ----------------------------------------------------------------
const state = {
  mode: 'solo',     // 'solo' 혼자 여러 장 비교 | 'group' 링크로 각자 올리기 (F7)
  step: 'home',
  members: [],      // 확인 화면에서 다루는 시간표 {id, name, file, preview, status, error, warnings, classes, gridStart}
  activeId: null,
  minMinutes: 30, // 기본은 가장 넓게 보여 주고, 필요하면 사용자가 좁힘
  result: null,
  group: null,      // {id, name, members: [{id, name, classes}]}
  groupResult: null,
  joinFile: null,
  deselected: new Set(), // 결과 비교에서 끈 사람 (id). 나는 끌 수 없음
};
let nextId = 1;
let refreshTimer = null;

// ---- 유틸 ----------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

const toMin = (t) => {
  if (!/^\d{1,2}:\d{2}$/.test(t || '')) return NaN;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const isValidClass = (c) => DAYS.includes(c.day) && toMin(c.start) < toMin(c.end);
// 90 -> '1시간 30분', 120 -> '2시간', 30 -> '30분'
const fmtMinutes = (m) => [m >= 60 ? `${Math.floor(m / 60)}시간` : '', m % 60 ? `${m % 60}분` : ''].filter(Boolean).join(' ');
const errText = (err) => (err instanceof TypeError ? '서버에 연결하지 못했습니다.' : err.message);

// 오늘 날짜로 이번 학기 계산: 1~7월은 1학기, 8~12월은 2학기 (8월부터 2학기 수강신청)
function currentSemester(now = new Date()) {
  const year = now.getFullYear();
  const term = now.getMonth() + 1 <= 7 ? 1 : 2;
  return `${year}년 ${term}학기`;
}

function getMember(id) {
  return state.members.find((m) => m.id === id);
}

function newMember({ name = '', file = null, classes = [], isMe = false } = {}) {
  return {
    id: nextId++,
    isMe,
    name,
    file,
    preview: file ? URL.createObjectURL(file) : null,
    status: file ? 'idle' : 'manual',
    error: null,
    warnings: [],
    classes: classes.map((c) => ({ ...c, id: nextId++ })),
    gridStart: 9,
  };
}

function newClass(member) {
  return { id: nextId++, day: 'MON', start: '09:00', end: '10:15', color: PALETTE[member.classes.length % PALETTE.length] };
}

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!data.ok) {
    const err = new Error(data.error.message);
    err.code = data.error.code;
    throw err;
  }
  return data;
}

const postJSON = (path, body) => api(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// 내가 이 그룹에 올린 멤버 ID는 이 기기에만 기억한다 (로그인 대신)
const mineKey = (gid) => `gongang:group:${gid}`;
function getMine(gid) {
  try { return JSON.parse(localStorage.getItem(mineKey(gid))); } catch { return null; }
}
function setMine(gid, value) {
  try {
    if (value) localStorage.setItem(mineKey(gid), JSON.stringify(value));
    else localStorage.removeItem(mineKey(gid));
  } catch { /* 저장 불가 브라우저는 무시 */ }
}

// ---- 라이트박스: 썸네일을 누르면 캡처 전체를 가운데에 띄우고 뒤 화면은 어둡고 흐리게 ----
let lightbox = null;

function openLightbox(src, alt) {
  if (lightbox) return;
  const box = el('div', {
    class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': alt,
    onclick: (e) => { if (e.target === box) closeLightbox(); }, // 바깥 누르면 닫기
  }, [
    el('img', { class: 'lightbox-img', src, alt }),
    el('button', { class: 'lightbox-close', type: 'button', 'aria-label': '닫기', text: '\u00d7', onclick: () => closeLightbox() }),
  ]);
  document.body.append(box);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => box.classList.add('open'));
  history.pushState({ lightbox: true }, ''); // 휴대폰 뒤로 가기로 닫히게
  lightbox = box;
}

function closeLightbox(fromHistory = false) {
  if (!lightbox) return;
  const box = lightbox;
  lightbox = null;
  box.classList.remove('open');
  document.body.classList.remove('no-scroll');
  setTimeout(() => box.remove(), 160);
  if (!fromHistory) history.back();
}

window.addEventListener('popstate', () => closeLightbox(true));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

function zoomableThumb(className, src, alt) {
  return el('img', {
    class: `${className} zoomable`, src, alt, title: '눌러서 크게 보기',
    onclick: () => openLightbox(src, alt),
  });
}

// ---- 화면 전환 -------------------------------------------------------------
function go(step) {
  state.step = step;
  document.querySelectorAll('main > .step').forEach((s) => { s.hidden = s.id !== `step-${step}`; });
  const steps = $('#steps');
  steps.hidden = !(state.mode === 'solo' && SOLO_STEPS.includes(step));
  steps.querySelectorAll('li').forEach((li) => {
    li.classList.toggle('active', li.dataset.step === step);
    li.classList.toggle('done', SOLO_STEPS.indexOf(li.dataset.step) < SOLO_STEPS.indexOf(step));
  });
  if (step === 'upload') renderUpload();
  if (step === 'review') renderReview();
  if (step === 'group') renderGroup();
  if (step === 'join') renderJoin();
  syncChips();
  clearInterval(refreshTimer);
  if (step === 'group') {
    refreshTimer = setInterval(() => { if (!document.hidden) loadGroup(true); }, REFRESH_MS);
  }
  window.scrollTo(0, 0);
}

// ---- 시간표 그리드 컴포넌트 --------------------------------------------------
// blocks: [{day, start, end, kind: 'class'|'free'|'partial', color, label}]
function renderTimetable(blocks, days = DAYS.slice(0, 5)) {
  const grid = el('div', { class: 'tt' });
  grid.style.setProperty('--days', days.length);
  grid.append(el('div', { class: 'tt-head' }));
  for (const d of days) grid.append(el('div', { class: 'tt-head', text: DAY_LABEL[d] }));

  const total = GRID_END - GRID_START;
  const times = el('div', { class: 'tt-times' });
  for (let h = 9; h < 18; h++) {
    times.append(el('span', { text: String(h), style: { top: `${((h * 60 - GRID_START) / total) * 100}%` } }));
  }
  grid.append(times);

  for (const d of days) {
    const col = el('div', { class: 'tt-col' });
    for (const b of blocks.filter((x) => x.day === d)) {
      const s = Math.max(toMin(b.start), GRID_START);
      const e = Math.min(toMin(b.end), GRID_END);
      if (!(s < e)) continue;
      col.append(el('div', {
        class: `tt-block ${b.kind || 'class'}`,
        style: {
          top: `${((s - GRID_START) / total) * 100}%`,
          height: `${((e - s) / total) * 100}%`,
          background: b.kind === 'class' || !b.kind ? b.color || PALETTE[0] : undefined,
        },
        text: b.label || '',
      }));
    }
    grid.append(col);
  }
  return grid;
}

// ---- 이미지 인식 (F1) --------------------------------------------------------
// Vercel 요청 한도를 넘으면 브라우저에서 JPEG로 다시 저장
async function prepareUpload(file) {
  if (file.size <= MAX_UPLOAD) return file;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

async function parseMember(m) {
  m.status = 'parsing';
  m.error = null;
  try {
    const body = await prepareUpload(m.file);
    const data = await api('/api/parse', {
      method: 'POST', headers: { 'Content-Type': body.type || 'application/octet-stream' }, body,
    });
    m.classes = data.classes.map((c) => ({ ...c, id: nextId++ }));
    m.warnings = data.warnings;
    m.status = 'done';
  } catch (err) {
    m.status = 'error';
    m.error = errText(err);
    m.classes = [];
    m.warnings = [];
  }
}

// ---- 공강 계산 (F4~F6) ------------------------------------------------------
async function fetchFree(members) {
  return postJSON('/api/free', {
    min_minutes: state.minMinutes,
    members: members.map((m) => ({
      name: m.name.trim(),
      classes: m.classes.map(({ day, start, end }) => ({ day, start, end })),
    })),
  });
}

function syncChips() {
  document.querySelectorAll('[data-chips] button').forEach((b) => {
    const on = Number(b.dataset.min) === state.minMinutes;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on);
  });
}

// ---- 같이 볼 사람 고르기: 이름을 토글로 켜고 꺼서 조합 (나는 항상 포함) -----------------
function selectedMembers(members, meId) {
  return members.filter((m) => m.id === meId || !state.deselected.has(m.id));
}

function renderPeople(container, members, meId, onChange) {
  container.replaceChildren();
  if (members.length < 2) return;
  const anyOff = members.some((m) => m.id !== meId && state.deselected.has(m.id));
  container.append(el('div', { class: 'people-head' }, [
    el('span', { text: '같이 볼 사람' }),
    anyOff ? el('button', {
      class: 'link-btn', type: 'button', text: '전체 선택',
      onclick: () => { state.deselected.clear(); onChange(); },
    }) : null,
  ]));
  const row = el('div', { class: 'people', role: 'group', 'aria-label': '같이 볼 사람' });
  // 나를 맨 앞에
  const ordered = [...members].sort((a, b) => (b.id === meId) - (a.id === meId));
  for (const m of ordered) {
    const isMe = m.id === meId;
    const on = isMe || !state.deselected.has(m.id);
    row.append(el('button', {
      type: 'button',
      class: isMe ? 'locked' : on ? 'on' : '',
      'aria-pressed': String(on),
      disabled: isMe,
      text: isMe ? (m.isMe ? '나' : `${m.name} (나)`) : m.name,
      onclick: () => {
        if (state.deselected.has(m.id)) state.deselected.delete(m.id);
        else state.deselected.add(m.id);
        onChange();
      },
    }));
  }
  container.append(row);
  if (!meId) {
    container.append(el('p', { class: 'hint', text: '내 시간표를 올리면 나는 항상 포함되고, 친구를 골라 1:1로도 볼 수 있어요.' }));
  }
}

function renderResult(panel, r) {
  panel.replaceChildren();
  const showPartial = r.common.length === 0 && r.partial.length > 0;
  const totalMin = r.common.reduce((sum, s) => sum + s.minutes, 0);
  panel.append(el('p', {
    class: 'summary',
    text: r.common.length
      ? `${r.member_count}명이 함께 비는 시간 ${r.common.length}개 · 합계 ${Math.floor(totalMin / 60)}시간 ${totalMin % 60}분`
      : `${fmtMinutes(r.min_minutes)} 이상 ${r.member_count}명이 모두 비는 시간이 없습니다.`,
  }));

  const blocks = r.common.map((s) => ({ ...s, kind: 'free', label: s.start }));
  if (showPartial) {
    for (const s of r.partial) blocks.push({ ...s, kind: 'partial', label: s.available.join('·') });
  }
  panel.append(renderTimetable(blocks));
  panel.append(el('div', { class: 'legend' }, [
    el('span', {}, [el('i', { class: 'l-free' }), '전원 가능']),
    showPartial ? el('span', {}, [el('i', { class: 'l-partial' }), `${r.member_count - 1}명 가능`]) : null,
  ]));

  if (r.common.length) {
    panel.append(el('h2', { class: 'section-title', text: '전원이 비는 시간' }));
    panel.append(el('ul', { class: 'slot-list' }, r.common.map((s) => el('li', {}, [
      el('span', { class: 'time', text: `${s.day_label} ${s.start}–${s.end}` }),
      el('span', { class: 'sub', text: `${s.minutes}분` }),
    ]))));
  }

  if (r.partial.length) {
    const list = el('ul', { class: 'slot-list partial' }, r.partial.slice(0, 10).map((s) => el('li', {}, [
      el('span', { class: 'time', text: `${s.day_label} ${s.start}–${s.end} (${s.minutes}분)` }),
      el('span', { class: 'sub', text: `가능: ${s.available.join(', ')} (${r.member_count}명 중 ${r.member_count - 1}명)` }),
    ])));
    if (showPartial) {
      panel.append(el('h2', { class: 'section-title', text: `차선 시간 · ${r.member_count}명 중 ${r.member_count - 1}명 가능` }), list);
    } else {
      panel.append(el('details', {}, [
        el('summary', { class: 'section-title', text: `차선 시간도 보기 (${r.partial.length})` }), list,
      ]));
    }
  } else if (!r.common.length && r.member_count >= 3) {
    panel.append(el('p', { class: 'empty', text: '한 명만 빠지는 시간도 없습니다. 최소 시간을 줄여 보세요.' }));
  }
}

// =============================================================================
// 그룹 모드 (F7): 링크를 카톡방에 공유 -> 각자 자기 시간표를 올림 -> 자동 비교
// =============================================================================
function groupLink(gid) {
  return `${location.origin}/?g=${gid}`;
}

async function createGroup() {
  const btn = $('#create-group');
  const errBox = $('#home-error');
  btn.disabled = true;
  errBox.hidden = true;
  try {
    const data = await postJSON('/api/group', { action: 'create', name: $('#group-name').value });
    history.replaceState(null, '', `/?g=${data.group_id}`);
    state.mode = 'group';
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
    const mine = getMine(gid);
    if (mine && !state.group.members.some((m) => m.id === mine.memberId)) setMine(gid, null); // 삭제된 경우
    state.group.loadedAt = new Date();
    state.group.error = null;
    await computeGroupFree();
  } catch (err) {
    if (!silent) state.group.error = errText(err);
  }
  if (state.step === 'group') renderGroup();
}

function groupMeId() {
  const mine = getMine(state.group.id);
  return mine && state.group.members.some((m) => m.id === mine.memberId) ? mine.memberId : null;
}

async function computeGroupFree() {
  const selected = selectedMembers(state.group.members, groupMeId());
  state.groupResult = selected.length >= 2 ? await fetchFree(selected) : null;
}

function renderGroup() {
  const g = state.group;
  const mine = getMine(g.id);
  $('#group-head').replaceChildren(
    el('h2', { text: g.name || '공강 그룹' }),
    el('p', { class: 'sub', text: `${g.members.length}명 참여 · 이 링크를 가진 사람은 누구나 보고 올릴 수 있어요` }),
  );

  // 링크 공유
  const link = groupLink(g.id);
  const copyBtn = el('button', {
    class: 'btn btn-ghost btn-small', type: 'button', text: '링크 복사',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(link);
        copyBtn.textContent = '복사됨';
      } catch {
        linkInput.select();
        copyBtn.textContent = '길게 눌러 복사';
      }
      setTimeout(() => { copyBtn.textContent = '링크 복사'; }, 2000);
    },
  });
  const linkInput = el('input', { class: 'share-link', value: link, readonly: true, 'aria-label': '그룹 링크' });
  $('#share-box').replaceChildren(
    el('p', { text: '카톡방에 이 링크를 올려 주세요. 각자 자기 시간표를 올리면 자동으로 비교됩니다.' }),
    el('div', { class: 'share-row' }, [
      linkInput,
      copyBtn,
      navigator.share ? el('button', {
        class: 'btn btn-primary btn-small', type: 'button', text: '공유',
        onclick: () => navigator.share({ title: '공강메이트', text: `${g.name || '공강 그룹'} 공강 맞추기`, url: link }).catch(() => {}),
      }) : null,
    ]),
  );

  // 내 시간표 올리기 / 수정
  $('#my-action').replaceChildren(el('button', {
    class: 'btn btn-primary', type: 'button',
    text: mine ? `내 시간표 수정 (${mine.name})` : '내 시간표 올리기',
    onclick: () => { state.joinFile = null; go('join'); },
  }));

  // 같이 볼 사람 + 결과
  const panel = $('#group-result');
  const meId = groupMeId();
  renderPeople($('#group-people'), g.members, meId, async () => {
    await computeGroupFree();
    renderGroup();
  });
  if (g.error) {
    panel.replaceChildren(el('p', { class: 'error-text', text: g.error }));
  } else if (g.members.length < 2) {
    panel.replaceChildren(el('div', { class: 'empty-box', text: g.members.length
      ? `지금 ${g.members.length}명이 올렸어요. 두 명 이상 올리면 같이 비는 시간이 보여요.`
      : '아직 아무도 올리지 않았어요. 먼저 내 시간표를 올려 보세요.' }));
  } else if (selectedMembers(g.members, meId).length < 2) {
    panel.replaceChildren(el('div', { class: 'empty-box', text: meId
      ? '같이 볼 친구를 한 명 이상 골라 주세요.' : '같이 볼 사람을 두 명 이상 골라 주세요.' }));
  } else if (state.groupResult) {
    renderResult(panel, state.groupResult);
  }

  // 참여자 목록
  const list = $('#group-members');
  list.replaceChildren();
  for (const m of g.members) {
    const isMine = mine && mine.memberId === m.id;
    list.append(el('li', {}, [
      el('span', { class: 'name', text: m.name }),
      isMine ? el('span', { class: 'badge', text: '나' }) : null,
      el('span', { class: 'sub', text: `수업 ${m.classes.length}개` }),
      isMine ? leaveButton(m) : null,
    ]));
  }
  if (!g.members.length) list.append(el('li', { class: 'empty', text: '아직 없습니다.' }));
  $('#group-updated').textContent = g.loadedAt
    ? `${g.loadedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준 · 15초마다 자동 갱신`
    : '';
}

// 두 번 눌러야 지워지는 버튼 (실수 방지, 브라우저 확인창 대신)
function leaveButton(m) {
  const btn = el('button', { class: 'icon-btn danger', type: 'button', text: '빼기' });
  btn.addEventListener('click', async () => {
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = '정말 뺄까요?';
      setTimeout(() => { btn.dataset.armed = ''; btn.textContent = '빼기'; }, 3000);
      return;
    }
    btn.disabled = true;
    try {
      await postJSON('/api/group', { action: 'delete', group_id: state.group.id, member_id: m.id });
      setMine(state.group.id, null);
      await loadGroup();
    } catch (err) {
      btn.textContent = errText(err);
    }
  });
  return btn;
}

// ---- 그룹: 내 시간표 올리기 -----------------------------------------------------
function renderJoin() {
  const mine = getMine(state.group.id);
  const saved = mine && state.group.members.find((m) => m.id === mine.memberId);
  $('#join-title').textContent = saved ? '내 시간표 수정' : '내 시간표 올리기';
  const nameInput = $('#join-name');
  if (!nameInput.value && saved) nameInput.value = saved.name;
  $('#join-error').hidden = true;

  const preview = $('#join-preview');
  if (state.joinFile) {
    preview.src = URL.createObjectURL(state.joinFile);
    preview.onclick = () => openLightbox(preview.src, '선택한 캡처');
    preview.classList.add('zoomable');
    preview.hidden = false;
    $('#join-file-label').textContent = '다른 캡처로 바꾸기';
  } else {
    preview.hidden = true;
    $('#join-file-label').textContent = '내 시간표 캡처 선택';
  }
  $('#join-next').textContent = state.joinFile ? '인식하기' : '캡처를 선택해 주세요';
  $('#join-next').disabled = !state.joinFile;

  const extra = $('#join-extra');
  extra.replaceChildren(el('button', {
    class: 'btn btn-ghost', type: 'button',
    text: saved ? '저장된 시간표 그대로 수정하기' : '캡처 없이 직접 입력하기',
    onclick: () => { if (startReview(saved ? saved.classes : [], false)) go('review'); },
  }));
}

function joinName() {
  const name = $('#join-name').value.trim();
  if (!name) {
    const box = $('#join-error');
    box.textContent = '이름을 먼저 입력해 주세요.';
    box.hidden = false;
    $('#join-name').focus();
  }
  return name;
}

function startReview(classes, withFile = true) {
  const name = joinName();
  if (!name) return null;
  const m = newMember({ name, file: withFile ? state.joinFile : null, classes });
  state.members = [m];
  state.activeId = m.id;
  return m;
}

async function joinParse() {
  const m = startReview([]);
  if (!m) return;
  const btn = $('#join-next');
  btn.disabled = true;
  btn.textContent = '인식 중...';
  await parseMember(m);
  go('review');
}

async function saveToGroup(claim = false) {
  const m = state.members[0];
  const problem = validateMembers();
  if (problem) return showReviewError(problem);
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
      name: m.name.trim(),
      classes: m.classes.map(({ day, start, end, color }) => ({ day, start, end, color })),
      claim,
    });
    setMine(gid, { memberId: data.member_id, name: m.name.trim() });
    $('#join-name').value = '';
    await loadGroup();
    go('group');
  } catch (err) {
    if (err.code === 'NAME_TAKEN' && !mine) showNameConflict(m.name.trim());
    else showReviewError(err.code === 'NAME_TAKEN' ? `'${m.name.trim()}'은(는) 이미 다른 사람이 쓰는 이름입니다.` : errText(err));
  } finally {
    btn.disabled = false;
    btn.textContent = '그룹에 저장';
  }
}

// 같은 이름이 이미 있을 때: 본인(다른 기기에서 올렸던 나)인지, 다른 사람인지 묻는다
function showNameConflict(name) {
  const box = $('#review-error');
  box.replaceChildren(
    el('p', { text: `이 그룹에 '${name}'이(가) 이미 있습니다.` }),
    el('div', { class: 'conflict-actions' }, [
      el('button', {
        class: 'btn btn-primary btn-small', type: 'button', text: `내가 그 ${name}이에요 · 내 시간표로 바꾸기`,
        onclick: () => saveToGroup(true),
      }),
      el('button', {
        class: 'btn btn-ghost btn-small', type: 'button', text: '다른 사람이에요 · 이름 바꾸기',
        onclick: () => {
          const input = $('#review-name');
          input.focus();
          input.select();
          box.replaceChildren(el('p', { text: '예: 재호B, 신재호처럼 구분되는 이름으로 바꾼 뒤 다시 저장해 주세요.' }));
        },
      }),
    ]),
  );
  box.hidden = false;
  box.scrollIntoView({ block: 'center' });
}

// =============================================================================
// 혼자 비교 모드: 한 사람이 여러 장을 올린다
// =============================================================================
// 1단계 = 내 시간표 1장, 2단계 = 친구 시간표 여러 장. 나는 항상 첫 번째 멤버
const soloMe = () => state.members.find((m) => m.isMe);
const soloFriends = () => state.members.filter((m) => !m.isMe);

function setSoloMe(file) {
  const old = soloMe();
  if (old && old.preview) URL.revokeObjectURL(old.preview);
  const me = newMember({ name: '나', file, isMe: true });
  state.members = [me, ...soloFriends()];
}

function addSoloFriend(file) {
  state.members.push(newMember({ name: `친구${soloFriends().length + 1}`, file }));
}

function removeMember(id) {
  const m = getMember(id);
  if (m && m.preview) URL.revokeObjectURL(m.preview);
  state.members = state.members.filter((x) => x.id !== id);
  renderUpload();
}

const STATUS_TEXT = {
  idle: '인식 전', parsing: '인식 중...', done: '인식 완료',
  error: '인식 실패 · 직접 입력 가능', manual: '직접 입력',
};

function memberCard(m) {
  return el('li', { class: 'member-card' }, [
    m.preview
      ? zoomableThumb('thumb', m.preview, `${m.isMe ? '내' : m.name} 시간표 캡처`)
      : el('div', { class: 'thumb', text: '직접' }),
    el('div', {}, [
      m.isMe
        ? el('div', { class: 'me-name', text: '나' })
        : el('input', { value: m.name, 'aria-label': '친구 이름', maxlength: 20, oninput: (e) => { m.name = e.target.value; } }),
      el('div', { class: `status ${m.status}`, text: m.error || STATUS_TEXT[m.status] }),
    ]),
    el('button', { class: 'icon-btn danger', type: 'button', text: '삭제', onclick: () => removeMember(m.id) }),
  ]);
}

function renderUpload() {
  const me = soloMe();
  const slot = $('#me-slot');
  if (me) {
    slot.replaceChildren(el('ul', { class: 'member-cards' }, [memberCard(me)]));
  } else {
    slot.replaceChildren(
      el('label', { class: 'upload-box', for: 'me-file' }, [
        el('strong', { text: '내 시간표 캡처 선택' }),
        el('span', { text: '에브리타임 시간표 탭 화면 1장' }),
      ]),
      el('button', {
        class: 'link-btn', type: 'button', text: '캡처 없이 직접 입력하기',
        onclick: () => { setSoloMe(null); renderUpload(); },
      }),
    );
  }

  const list = $('#member-cards');
  list.replaceChildren(...soloFriends().map(memberCard));

  const pending = state.members.filter((m) => m.file && m.status !== 'done').length;
  const btn = $('#start-parse');
  const ready = me && soloFriends().length > 0;
  btn.disabled = !ready;
  if (!me) btn.textContent = '내 시간표를 먼저 올려 주세요';
  else if (!soloFriends().length) btn.textContent = '친구 시간표를 올려 주세요';
  else btn.textContent = pending ? `시간표 인식하기 (${pending}장)` : '다음';
}

async function parseAll() {
  const btn = $('#start-parse');
  btn.disabled = true;
  const targets = state.members.filter((m) => m.file && m.status !== 'done');
  targets.forEach((m) => { m.status = 'parsing'; });
  renderUpload();
  await Promise.all(targets.map(parseMember)); // 한 장씩 따로 요청, 동시에 보냄
  state.activeId = state.members[0].id;
  go('review');
}

async function findFreeSolo() {
  const panel = $('#result-panel');
  const me = soloMe();
  renderPeople($('#solo-people'), state.members, me && me.id, findFreeSolo);
  const selected = selectedMembers(state.members, me && me.id);
  if (selected.length < 2) {
    panel.replaceChildren(el('div', { class: 'empty-box', text: '비교할 친구를 한 명 이상 골라 주세요.' }));
    return;
  }
  panel.replaceChildren(el('p', { class: 'loading', text: '공강을 찾는 중...' }));
  try {
    state.result = await fetchFree(selected);
    renderResult(panel, state.result);
  } catch (err) {
    panel.replaceChildren(el('p', { class: 'error-text', text: errText(err) }));
  }
}

// =============================================================================
// 확인·수정 화면 (F2) — 두 모드 공용
// =============================================================================
function renderTabs() {
  const tabs = $('#member-tabs');
  tabs.replaceChildren();
  tabs.hidden = state.members.length < 2;
  for (const m of state.members) {
    const needsCheck = m.warnings.length > 0 || m.status === 'error';
    tabs.append(el('button', {
      type: 'button', role: 'tab', class: m.id === state.activeId ? 'active' : '',
      onclick: () => { state.activeId = m.id; renderReview(); },
    }, [m.name || '이름 없음', needsCheck ? el('span', { class: 'dot', title: '확인 필요' }) : null]));
  }
}

function renderPreview(m) {
  const box = $('#review-preview');
  if (!box) return;
  const blocks = m.classes.filter(isValidClass).map((c) => ({ ...c, kind: 'class' }));
  const days = m.classes.some((c) => c.day === 'SAT') ? DAYS : DAYS.slice(0, 5);
  box.replaceChildren(renderTimetable(blocks, days));
}

function shiftClasses(m, newStart) {
  const delta = (newStart - m.gridStart) * 60;
  m.gridStart = newStart;
  for (const c of m.classes) {
    const s = toMin(c.start) + delta;
    const e = toMin(c.end) + delta;
    if (s >= 0 && e <= 24 * 60) {
      c.start = toHHMM(s);
      c.end = toHHMM(e);
    }
  }
}

function classRow(m, c) {
  const row = el('li', { class: `class-row ${isValidClass(c) ? '' : 'invalid'}` });
  const update = (key) => (e) => {
    c[key] = e.target.value;
    row.classList.toggle('invalid', !isValidClass(c));
    renderPreview(m);
  };
  row.append(
    el('span', { class: 'swatch', style: { background: c.color || PALETTE[0] } }),
    el('select', { 'aria-label': '요일', onchange: update('day') },
      DAYS.map((d) => el('option', { value: d, selected: d === c.day, text: `${DAY_LABEL[d]}요일` }))),
    el('input', { class: 't-start', type: 'time', step: 300, value: c.start, 'aria-label': '시작', onchange: update('start') }),
    el('span', { class: 'sep', text: '~' }),
    el('input', { class: 't-end', type: 'time', step: 300, value: c.end, 'aria-label': '종료', onchange: update('end') }),
    el('button', {
      class: 'icon-btn danger', type: 'button', text: '삭제',
      onclick: () => { m.classes = m.classes.filter((x) => x !== c); renderReview(); },
    }),
  );
  return row;
}

function renderReview() {
  if (!getMember(state.activeId)) state.activeId = state.members[0] && state.members[0].id;
  renderTabs();
  const panel = $('#review-panel');
  panel.replaceChildren();
  $('#review-error').hidden = true;
  const group = state.mode === 'group';
  $('#review-next').textContent = group ? '그룹에 저장' : '공강 찾기';
  $('#review-back').textContent = group ? '이전' : '이전';
  const m = getMember(state.activeId);
  if (!m) {
    panel.append(el('p', { class: 'empty', text: '먼저 시간표를 추가해 주세요.' }));
    return;
  }

  // 이름 (원본 캡처 위쪽 이름을 보며 고칠 수 있게 맨 위에). 혼자 비교의 내 시간표는 '나'로 고정
  if (m.isMe) {
    panel.append(el('p', { class: 'me-name review', text: '내 시간표' }));
  } else {
    panel.append(el('label', { class: 'field' }, [
      el('span', { text: group ? '내 이름' : '친구 이름' }),
      el('input', {
        id: 'review-name', value: m.name, maxlength: 20, placeholder: '이름',
        oninput: (e) => { m.name = e.target.value; if (!group) renderTabs(); },
      }),
    ]));
  }

  // 원본 캡처와 학기 확인 안내 (지난 학기 캡처를 잘못 올리는 경우 대비)
  if (m.preview) {
    panel.append(el('div', { class: 'source-check' }, [
      zoomableThumb('source-thumb', m.preview, `${m.isMe ? '내' : m.name} 원본 캡처`),
      el('p', {}, [
        el('strong', { text: `${currentSemester()} 시간표가 맞나요?` }),
        el('br'),
        '캡처 위쪽 학기 탭을 확인해 주세요. 다른 학기라면 이전 화면에서 캡처를 다시 골라 주세요.',
      ]),
    ]));
  }

  if (m.status === 'error') {
    panel.append(el('div', { class: 'alert error', text: `${m.error} 아래에서 수업을 직접 추가할 수 있습니다.` }));
  }
  if (m.warnings.length) {
    panel.append(el('div', { class: 'alert' }, [el('ul', {}, m.warnings.map((w) => el('li', { text: w.message })))]));
  }

  panel.append(el('div', { id: 'review-preview' }));

  if (m.status === 'done') {
    panel.append(el('div', { class: 'row-inline' }, [
      el('span', { class: 'sub', text: '캡처 맨 위 시각' }),
      el('select', {
        'aria-label': '캡처 맨 위 시각',
        onchange: (e) => { shiftClasses(m, Number(e.target.value)); renderReview(); },
      }, [8, 9, 10, 11].map((h) => el('option', { value: h, selected: h === m.gridStart, text: `${h}시` }))),
    ]));
  }

  panel.append(el('div', { class: 'row-inline' }, [
    el('h2', { text: `수업 ${m.classes.length}개` }),
    el('button', {
      class: 'btn btn-ghost btn-small', type: 'button', text: '수업 추가',
      onclick: () => { m.classes.push(newClass(m)); renderReview(); },
    }),
  ]));

  const list = el('ul', { class: 'class-list' });
  if (!m.classes.length) list.append(el('li', { class: 'empty', text: '수업이 없습니다. 모든 요일이 비어 있는 것으로 계산합니다.' }));
  for (const c of m.classes) list.append(classRow(m, c));
  panel.append(list);

  renderPreview(m);
}

function validateMembers() {
  const names = state.members.map((m) => m.name.trim());
  if (!state.members.length) return '시간표를 한 장 이상 추가해 주세요.';
  if (names.some((n) => !n)) return '이름이 비어 있습니다. 이름을 적어 주세요.';
  if (names.some((n) => n.length > 20)) return '이름은 20자 이하로 적어 주세요.';
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) return `이름 '${dup}'이(가) 중복되었습니다.`;
  for (const m of state.members) {
    if (m.classes.some((c) => !isValidClass(c))) {
      state.activeId = m.id;
      return `${m.name}의 수업 중 종료 시각이 시작보다 빠른 항목이 있습니다.`;
    }
  }
  return null;
}

function showReviewError(message) {
  renderReview();
  const box = $('#review-error');
  box.replaceChildren(el('p', { text: message }));
  box.hidden = false;
}

// ---- 이벤트 연결 -----------------------------------------------------------
$('#create-group').addEventListener('click', createGroup);

$('#me-file').addEventListener('change', (e) => {
  if (e.target.files[0]) setSoloMe(e.target.files[0]);
  e.target.value = '';
  renderUpload();
});
$('#file-input').addEventListener('change', (e) => {
  for (const file of e.target.files) addSoloFriend(file);
  e.target.value = '';
  renderUpload();
});
$('#add-manual').addEventListener('click', () => { addSoloFriend(null); renderUpload(); });
$('#start-parse').addEventListener('click', parseAll);

$('#join-file').addEventListener('change', (e) => {
  state.joinFile = e.target.files[0] || null;
  e.target.value = '';
  renderJoin();
});
$('#join-next').addEventListener('click', joinParse);

$('#review-back').addEventListener('click', () => go(state.mode === 'group' ? 'join' : 'upload'));
$('#review-next').addEventListener('click', () => {
  if (state.mode === 'group') {
    saveToGroup();
    return;
  }
  const problem = validateMembers();
  if (problem) return showReviewError(problem);
  state.deselected.clear();
  go('result');
  findFreeSolo();
});

document.querySelectorAll('[data-chips]').forEach((chips) => chips.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-min]');
  if (!btn) return;
  state.minMinutes = Number(btn.dataset.min);
  syncChips();
  if (state.step === 'group') {
    await computeGroupFree();
    renderGroup();
  } else {
    findFreeSolo();
  }
}));

document.querySelectorAll('[data-go]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.go === 'upload') state.mode = 'solo';
    go(btn.dataset.go);
  });
});

// ---- 시작: 링크(?g=)로 들어왔으면 그룹 화면, 아니면 첫 화면 ---------------------------
(async function start() {
  const gid = new URLSearchParams(location.search).get('g');
  if (!gid) {
    go('home');
    return;
  }
  state.mode = 'group';
  state.group = { id: gid, name: '', members: [] };
  go('group');
  await loadGroup();
})();
