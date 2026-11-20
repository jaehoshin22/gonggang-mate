'use strict';

// ---- 상수 ----------------------------------------------------------------
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_LABEL = { MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금', SAT: '토', SUN: '일' };
const GRID_START = 9 * 60; // 그리드 기본 범위 (블록이 벗어나면 늘어남)
const GRID_END = 18 * 60;
const MAX_UPLOAD = 4 * 1024 * 1024;
const REFRESH_MS = 15000; // 그룹 화면 자동 새로고침 간격
const PALETTE = ['#f28c8c', '#82b4f0', '#8ccda0', '#f5be6e', '#b496e1', '#6ec8c8', '#f0a0c8', '#c8be78'];
const HOUR_PX = 64;      // 결과 그리드 1시간 높이 (style.css .tt.tall --hour 와 같게)
const LINE_PX = 13.6;    // 칸 안 글자 한 줄 높이

// ---- 상태 ----------------------------------------------------------------
const state = {
  step: 'home',
  group: null,      // {id, name, members: [{id, name, classes}]}
  result: null,     // /api/free 응답
  joinFile: null,
  draft: null,      // 확인 화면에서 고치는 내 시간표 {name, status, error, warnings, classes, gridStart}
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

// ---- 화면 전환 -------------------------------------------------------------
function go(step) {
  state.step = step;
  closeDetail();
  document.querySelectorAll('main > .step').forEach((s) => { s.hidden = s.id !== `step-${step}`; });
  if (step === 'review') renderReview();
  if (step === 'group') renderGroup();
  if (step === 'join') renderJoin();
  clearInterval(refreshTimer);
  if (step === 'group') {
    refreshTimer = setInterval(() => { if (!document.hidden && !detail) loadGroup(true); }, REFRESH_MS);
  }
  window.scrollTo(0, 0);
}

// ---- 시간표 그리드 컴포넌트 --------------------------------------------------
// blocks: [{day, start, end, className, color, content, title, onclick}]
function renderTimetable(blocks, days, { tall = false } = {}) {
  // 기본 9~18시, 블록이 그 밖에 있으면 정시 단위로 늘린다 (예: 18:25 저녁 수업)
  const valid = blocks.filter((b) => toMin(b.start) < toMin(b.end));
  const from = Math.min(GRID_START, ...valid.map((b) => Math.floor(toMin(b.start) / 60) * 60));
  const to = Math.max(GRID_END, ...valid.map((b) => Math.ceil(toMin(b.end) / 60) * 60));
  const total = to - from;

  const grid = el('div', { class: `tt${tall ? ' tall' : ''}` });
  grid.style.setProperty('--days', days.length);
  grid.style.setProperty('--hours', total / 60);
  grid.append(el('div', { class: 'tt-head' }));
  for (const d of days) grid.append(el('div', { class: 'tt-head', text: DAY_LABEL[d] }));

  const times = el('div', { class: 'tt-times' });
  for (let m = from; m < to; m += 60) {
    times.append(el('span', { text: String(m / 60), style: { top: `${((m - from) / total) * 100}%` } }));
  }
  grid.append(times);

  for (const d of days) {
    const col = el('div', { class: 'tt-col' });
    for (const b of valid.filter((x) => x.day === d)) {
      const s = toMin(b.start);
      const e = toMin(b.end);
      col.append(el(b.onclick ? 'button' : 'div', {
        class: `tt-block ${b.className || 'class'}`,
        type: b.onclick ? 'button' : undefined,
        title: b.title,
        'aria-label': b.title,
        onclick: b.onclick,
        style: {
          top: `${((s - from) / total) * 100}%`,
          height: `${((e - s) / total) * 100}%`,
          background: b.color,
        },
      }, b.content || []));
    }
    grid.append(col);
  }
  return grid;
}

// ---- 이미지 인식 -------------------------------------------------------------
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

async function parseDraft(d, file) {
  try {
    const body = await prepareUpload(file);
    const data = await api('/api/parse', {
      method: 'POST', headers: { 'Content-Type': body.type || 'application/octet-stream' }, body,
    });
    d.classes = data.classes.map((c) => ({ ...c, id: nextId++ }));
    d.warnings = data.warnings;
    d.status = 'done';
  } catch (err) {
    // 인식 실패: 빈 수정 화면에서 직접 입력
    d.status = 'error';
    d.error = errText(err);
    d.classes = [];
    d.warnings = [];
  }
}

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
    history.replaceState(null, '', `/?g=${data.group_id}`);
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

async function shareLink() {
  const link = groupLink(state.group.id);
  const btn = $('#share-btn');
  if (navigator.share) {
    navigator.share({ title: '공강메이트', text: `${state.group.name || '공강 그룹'} 공강 맞추기`, url: link }).catch(() => {});
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    btn.textContent = '복사됨';
  } catch {
    window.prompt('링크를 복사해 주세요', link);
  }
  setTimeout(() => { btn.textContent = '링크 공유'; }, 2000);
}

function renderGroup() {
  const g = state.group;
  const me = myName();

  $('#group-head').replaceChildren(
    el('div', {}, [
      el('h2', { text: g.name || '공강 그룹' }),
      el('p', { class: 'sub', text: `${g.members.length}명 참여` }),
    ]),
    el('button', { id: 'share-btn', class: 'btn btn-ghost btn-small', type: 'button', text: '링크 공유', onclick: shareLink }),
  );

  $('#my-action').replaceChildren(el('button', {
    class: `btn ${me ? 'btn-ghost' : 'btn-primary'}`, type: 'button',
    text: me ? `내 시간표 다시 올리기 (${me})` : '내 시간표 올리기',
    onclick: () => { state.joinFile = null; go('join'); },
  }));

  const panel = $('#group-result');
  if (g.error) {
    panel.replaceChildren(el('p', { class: 'error-text', text: g.error }));
  } else if (g.members.length < 2 || !state.result) {
    panel.replaceChildren(el('div', { class: 'empty-box', text: g.members.length
      ? `지금 ${g.members.length}명이 올렸어요. 두 명 이상 올리면 같이 비는 시간이 보여요. 링크를 카톡방에 공유해 주세요.`
      : '아직 아무도 올리지 않았어요. 먼저 내 시간표를 올리고 링크를 카톡방에 공유해 주세요.' }));
  } else {
    renderResult(panel, state.result, me);
  }

  $('#group-updated').textContent = g.loadedAt
    ? `${g.loadedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준 · 15초마다 자동 갱신`
    : '';
}

// ---- 결과: 주간 시간표 각 칸에 같이 비는 사람 이름 -----------------------------
// 색은 '나'에게만: 내가 포함된 칸은 강조, 나머지는 약하게
// 칸 높이에 맞춰 내용 줄이기: 맨 위 인원 수, 그 아래 이름, 넘치면 '외 N명'
function slotContent(s, me) {
  const mine = me && s.names.includes(me);
  const names = mine ? [me, ...s.names.filter((n) => n !== me)] : s.names;
  const name = (n) => el('span', { class: n === me ? 'me' : '', text: n });
  const lines = Math.max(1, Math.floor(((s.minutes / 60) * HOUR_PX - 6) / LINE_PX));
  if (lines === 1) {
    // 30분 안팎의 짧은 칸: 인원 수만, 이름은 눌러서 확인
    return [el('span', { class: mine ? 'count me' : 'count', text: `${s.count}명` })];
  }
  const room = lines - 1; // 인원 수 줄 제외
  const shown = names.length <= room ? names : names.slice(0, room - 1);
  const rest = names.length - shown.length;
  return [
    el('span', { class: 'count', text: `${s.count}명` }),
    ...shown.map(name),
    rest ? el('span', { class: 'more', text: `외 ${rest}명` }) : null,
  ];
}

// ---- 결과: 주간 시간표 각 칸에 같이 비는 사람 (30분 미만은 서버에서 제외) ------------
// 색은 '나'에게만: 내가 포함된 칸은 강조, 나머지는 약하게
function renderResult(panel, r, me) {
  panel.replaceChildren();
  const segs = r.segments;
  if (!segs.length) {
    panel.append(el('div', { class: 'empty-box', text: '수업 사이에 30분 이상 같이 비는 시간이 아직 없어요.' }));
    return;
  }
  const blocks = segs.map((s) => ({
    ...s,
    className: `slot ${me && s.names.includes(me) ? 'mine' : 'other'}`,
    title: `${s.day_label} ${s.start}–${s.end} ${s.names.join(', ')}`,
    content: slotContent(s, me),
    onclick: () => openDetail(s, me),
  }));
  const days = segs.some((s) => s.day === 'SAT') ? DAYS : DAYS.slice(0, 5);
  panel.append(renderTimetable(blocks, days, { tall: true }));
  panel.append(el('div', { class: 'legend' }, [
    me ? el('span', {}, [el('i', { class: 'l-mine' }), '내가 포함된 공강']) : null,
    el('span', {}, [el('i', { class: 'l-other' }), me ? '나 없이 친구들만' : '같이 비는 공강']),
    el('span', { class: 'legend-hint', text: '칸을 누르면 자세히' }),
  ]));
}

// ---- 구간 상세 팝업 ----------------------------------------------------------
let detail = null;

function openDetail(s, me) {
  closeDetail();
  const box = el('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '공강 상세',
    onclick: (e) => { if (e.target === box) closeDetail(); },
  }, [
    el('div', { class: 'modal-card' }, [
      el('div', { class: 'modal-top' }, [
        el('h3', { text: `${s.day_label}요일 ${s.start}–${s.end}` }),
        el('button', { class: 'modal-close', type: 'button', 'aria-label': '닫기', text: '×', onclick: closeDetail }),
      ]),
      el('p', { class: 'modal-sub', text: `${fmtMinutes(s.minutes)} · ${s.count}명${s.everyone ? ' (전원)' : ''}` }),
      el('ul', { class: 'modal-names' }, s.names.map((n) => el('li', { class: n === me ? 'me' : '', text: n === me ? `${n} (나)` : n }))),
    ]),
  ]);
  document.body.append(box);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => box.classList.add('open'));
  detail = box;
}

function closeDetail() {
  if (!detail) return;
  const box = detail;
  detail = null;
  document.body.classList.remove('no-scroll');
  box.remove();
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

// ---- 내 시간표 올리기 ----------------------------------------------------------
function renderJoin() {
  const me = myName();
  $('#join-title').textContent = me ? '내 시간표 다시 올리기' : '내 시간표 올리기';
  const nameInput = $('#join-name');
  if (!nameInput.value && me) nameInput.value = me;
  $('#join-error').hidden = true;

  const preview = $('#join-preview');
  if (state.joinFile) {
    preview.src = URL.createObjectURL(state.joinFile);
    preview.hidden = false;
    $('#join-file-label').textContent = '다른 캡처로 바꾸기';
  } else {
    preview.hidden = true;
    $('#join-file-label').textContent = '내 시간표 캡처 선택';
  }
  const btn = $('#join-next');
  btn.textContent = state.joinFile ? '인식하기' : '캡처를 선택해 주세요';
  btn.disabled = !state.joinFile;
}

async function joinParse() {
  const name = $('#join-name').value.trim();
  if (!name) {
    const box = $('#join-error');
    box.textContent = '이름을 먼저 입력해 주세요.';
    box.hidden = false;
    $('#join-name').focus();
    return;
  }
  const btn = $('#join-next');
  btn.disabled = true;
  btn.textContent = '인식 중...';
  state.draft = { name, status: 'parsing', error: null, warnings: [], classes: [], gridStart: 9 };
  await parseDraft(state.draft, state.joinFile);
  go('review');
}

async function saveToGroup(claim = false) {
  const d = state.draft;
  const problem = validateDraft();
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
      name: d.name.trim(),
      classes: d.classes.map(({ day, start, end, color }) => ({ day, start, end, color })),
      claim,
    });
    setMine(gid, { memberId: data.member_id, name: d.name.trim() });
    $('#join-name').value = '';
    await loadGroup();
    go('group');
  } catch (err) {
    if (err.code === 'NAME_TAKEN' && !mine) showNameConflict(d.name.trim());
    else showReviewError(err.code === 'NAME_TAKEN' ? `'${d.name.trim()}'은(는) 이미 다른 사람이 쓰는 이름입니다.` : errText(err));
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
// 확인·수정 화면: 미리보기 + 수업 추가·수정·삭제
// =============================================================================
function renderPreview(d) {
  const box = $('#review-preview');
  if (!box) return;
  const blocks = d.classes.filter(isValidClass).map((c) => ({ ...c, color: c.color || PALETTE[0] }));
  const days = d.classes.some((c) => c.day === 'SAT') ? DAYS : DAYS.slice(0, 5);
  box.replaceChildren(renderTimetable(blocks, days));
}

function shiftClasses(d, newStart) {
  const delta = (newStart - d.gridStart) * 60;
  d.gridStart = newStart;
  for (const c of d.classes) {
    const s = toMin(c.start) + delta;
    const e = toMin(c.end) + delta;
    if (s >= 0 && e <= 24 * 60) {
      c.start = toHHMM(s);
      c.end = toHHMM(e);
    }
  }
}

function classRow(d, c) {
  const row = el('li', { class: `class-row ${isValidClass(c) ? '' : 'invalid'}` });
  const update = (key) => (e) => {
    c[key] = e.target.value;
    row.classList.toggle('invalid', !isValidClass(c));
    renderPreview(d);
  };
  row.append(
    el('span', { class: 'swatch', style: { background: c.color || PALETTE[0] } }),
    el('select', { 'aria-label': '요일', onchange: update('day') },
      DAYS.map((day) => el('option', { value: day, selected: day === c.day, text: `${DAY_LABEL[day]}요일` }))),
    el('input', { class: 't-start', type: 'time', step: 300, value: c.start, 'aria-label': '시작', onchange: update('start') }),
    el('span', { class: 'sep', text: '~' }),
    el('input', { class: 't-end', type: 'time', step: 300, value: c.end, 'aria-label': '종료', onchange: update('end') }),
    el('button', {
      class: 'icon-btn danger', type: 'button', text: '삭제',
      onclick: () => { d.classes = d.classes.filter((x) => x !== c); renderReview(); },
    }),
  );
  return row;
}

function renderReview() {
  const d = state.draft;
  const panel = $('#review-panel');
  panel.replaceChildren();
  $('#review-error').hidden = true;
  if (!d) return;

  panel.append(el('label', { class: 'field' }, [
    el('span', { text: '내 이름' }),
    el('input', { id: 'review-name', value: d.name, maxlength: 20, placeholder: '이름', oninput: (e) => { d.name = e.target.value; } }),
  ]));

  if (d.status === 'error') {
    panel.append(el('div', { class: 'alert error', text: `${d.error} 아래에서 수업을 직접 추가해 주세요.` }));
  }
  if (d.warnings.length) {
    panel.append(el('div', { class: 'alert' }, [
      el('p', { text: d.warnings.map((w) => w.message).join(' ') }),
      // 경고가 있을 때만: 캡처 맨 위 시각이 9시가 아니면 전체를 밀어 맞춘다
      el('div', { class: 'row-inline' }, [
        el('span', { class: 'sub', text: '캡처 맨 위 시각' }),
        el('select', {
          'aria-label': '캡처 맨 위 시각',
          onchange: (e) => { shiftClasses(d, Number(e.target.value)); renderReview(); },
        }, [8, 9, 10, 11].map((h) => el('option', { value: h, selected: h === d.gridStart, text: `${h}시` }))),
      ]),
    ]));
  }

  panel.append(el('div', { id: 'review-preview' }));

  panel.append(el('div', { class: 'row-inline' }, [
    el('h2', { text: `수업 ${d.classes.length}개` }),
    el('button', {
      class: 'btn btn-ghost btn-small', type: 'button', text: '수업 추가',
      onclick: () => {
        d.classes.push({ id: nextId++, day: 'MON', start: '09:00', end: '10:15', color: PALETTE[d.classes.length % PALETTE.length] });
        renderReview();
      },
    }),
  ]));

  const list = el('ul', { class: 'class-list' });
  if (!d.classes.length) list.append(el('li', { class: 'empty', text: '수업이 없습니다. 모든 요일에 학교에 오지 않는 것으로 계산합니다.' }));
  for (const c of d.classes) list.append(classRow(d, c));
  panel.append(list);

  renderPreview(d);
}

function validateDraft() {
  const name = state.draft.name.trim();
  if (!name) return '이름이 비어 있습니다. 이름을 적어 주세요.';
  if (name.length > 20) return '이름은 20자 이하로 적어 주세요.';
  if (state.draft.classes.some((c) => !isValidClass(c))) return '종료 시각이 시작보다 빠른 수업이 있습니다.';
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
$('#join-file').addEventListener('change', (e) => {
  state.joinFile = e.target.files[0] || null;
  e.target.value = '';
  renderJoin();
});
$('#join-next').addEventListener('click', joinParse);
$('#join-cancel').addEventListener('click', () => go('group'));
$('#review-back').addEventListener('click', () => go('join'));
$('#review-next').addEventListener('click', () => saveToGroup());

// ---- 시작: 링크(?g=)로 들어왔으면 그룹 화면, 아니면 첫 화면 ---------------------------
(async function start() {
  const gid = new URLSearchParams(location.search).get('g');
  if (!gid) {
    go('home');
    return;
  }
  state.group = { id: gid, name: '', members: [] };
  go('group');
  await loadGroup();
})();
