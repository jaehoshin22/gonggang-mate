'use strict';

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
  solo: { members: [], result: null, error: null }, // members: [{name, classes}]
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
// img/icons.svg 의 아이콘을 SVG 요소로 만든다
function icon(name, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `img/icons.svg#${name}`);
  svg.append(use);
  return svg;
}
const errText = (err) => (err instanceof TypeError ? '서버에 연결하지 못했어요.' : err.message);

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
function renderResult(panel, r, me, title, footnote) {
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
  panel.append(el('p', { class: 'result-rule', text: '수업 사이에 30분 이상 같이 비는 시간만 보여요.' }));
  panel.append(renderTimetable(blocks, days, { tall: true }));
  panel.append(el('div', { class: 'legend' }, [
    me ? el('span', {}, [el('i', { class: 'l-mine' }), '나도 비는 시간']) : null,
    el('span', {}, [el('i', { class: 'l-other' }), me ? '나는 안 되는 시간' : '같이 비는 시간']),
    el('span', { class: 'legend-hint', text: '누르면 자세히' }),
  ]));
  panel.append(el('button', {
    class: 'btn btn-ghost btn-arrow save-image', type: 'button', onclick: () => saveResultImage(r, title),
  }, [icon('download', 16), '이미지로 저장']));
  if (footnote) panel.append(el('p', { class: 'footnote', text: footnote }));
}

// ---- 결과를 이미지로 저장 ------------------------------------------------------
// 화면 그리드와 따로, 공유용으로 canvas에 직접 그린다 (나 강조 없이 모두에게 같은 그림).
const IMG = {
  W: 1080, PAD: 44, TOP: 150, TIME_W: 56, HEAD_H: 46, HOUR: 132, FOOT: 76,
  LINE: 26, ACCENT: '#5b48e0', SOFT: '#eeebff', EDGE: '#cfc8f8', INK: '#2a2447', MUTED: '#6b7079', LINEC: '#e3e5e8', FAINT: '#f0f1f3',
};

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 너비를 넘으면 끝을 '…'로 줄인다
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

// 칸 안 글: '3명' 뒤에 이름을 이어 쓰고, 칸이 모자라면 줄을 바꾸고, 그래도 넘치면 '외 N명'
function drawSlotText(ctx, s, x, y, w, h, family) {
  const gap = 10;
  const maxW = w - 20;
  const maxLines = Math.max(1, Math.floor((h - 8) / IMG.LINE));
  const style = {
    count: { font: `700 20px ${family}`, color: IMG.ACCENT },
    name: { font: `500 21px ${family}`, color: IMG.INK },
    more: { font: `500 20px ${family}`, color: IMG.MUTED },
  };
  const token = (text, kind) => {
    ctx.font = style[kind].font;
    const t = fitText(ctx, text, maxW);
    return { t, kind, w: ctx.measureText(t).width };
  };
  const lineWidth = (line) => line.reduce((sum, tk, i) => sum + tk.w + (i ? gap : 0), 0);

  let lines = [[]];
  for (const tk of [token(`${s.count}명`, 'count'), ...s.names.map((n) => token(n, 'name'))]) {
    const cur = lines[lines.length - 1];
    if (cur.length && lineWidth(cur) + gap + tk.w > maxW) lines.push([tk]);
    else cur.push(tk);
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines[lines.length - 1];
    const keepMin = lines.length === 1 ? 1 : 0; // 첫 줄의 '3명'은 남긴다
    const shownNames = () => lines.flat().filter((tk) => tk.kind === 'name').length;
    let more = token(`외 ${s.names.length - shownNames()}명`, 'more');
    while (last.length > keepMin && lineWidth(last) + gap + more.w > maxW) {
      last.pop();
      more = token(`외 ${s.names.length - shownNames()}명`, 'more');
    }
    last.push(more);
  }

  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, i) => {
    let cx = x + 10;
    for (const tk of line) {
      ctx.font = style[tk.kind].font;
      ctx.fillStyle = style[tk.kind].color;
      ctx.fillText(tk.t, cx, y + 6 + IMG.LINE * i + 19);
      cx += tk.w + gap;
    }
  });
}

function buildResultImage(r, title) {
  const segs = r.segments;
  const days = segs.some((s) => s.day === 'SAT') ? DAYS : DAYS.slice(0, 5);
  const from = Math.min(GRID_START, ...segs.map((s) => Math.floor(toMin(s.start) / 60) * 60));
  const to = Math.max(GRID_END, ...segs.map((s) => Math.ceil(toMin(s.end) / 60) * 60));
  const family = getComputedStyle(document.body).fontFamily;

  const gridW = IMG.W - IMG.PAD * 2;
  const colW = (gridW - IMG.TIME_W) / days.length;
  const bodyH = ((to - from) / 60) * IMG.HOUR;
  const gridH = IMG.HEAD_H + bodyH;
  const H = IMG.TOP + gridH + IMG.FOOT;

  const canvas = document.createElement('canvas');
  canvas.width = IMG.W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, IMG.W, H);

  // 제목
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = IMG.INK;
  ctx.font = `700 44px ${family}`;
  ctx.fillText(fitText(ctx, title, gridW), IMG.PAD, IMG.PAD + 46);
  ctx.fillStyle = IMG.MUTED;
  ctx.font = `400 24px ${family}`;
  ctx.fillText(`${r.member_count}명 · 수업 사이에 30분 이상 같이 비는 시간`, IMG.PAD, IMG.PAD + 92);

  // 그리드 틀
  const gx = IMG.PAD;
  const gy = IMG.TOP;
  const bodyY = gy + IMG.HEAD_H;
  ctx.save();
  rrect(ctx, gx, gy, gridW, gridH, 16);
  ctx.clip();
  ctx.fillStyle = '#f6f7f9';
  ctx.fillRect(gx, gy, gridW, IMG.HEAD_H);
  ctx.lineWidth = 2;
  for (let m = from; m <= to; m += 30) {
    const y = bodyY + ((m - from) / 60) * IMG.HOUR;
    ctx.strokeStyle = m % 60 === 0 ? IMG.LINEC : IMG.FAINT;
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx + gridW, y);
    ctx.stroke();
  }
  ctx.strokeStyle = IMG.LINEC;
  for (let i = 0; i < days.length; i++) {
    const x = gx + IMG.TIME_W + colW * i;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x, gy + gridH);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(gx, bodyY);
  ctx.lineTo(gx + gridW, bodyY);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = IMG.LINEC;
  ctx.lineWidth = 2;
  rrect(ctx, gx, gy, gridW, gridH, 16);
  ctx.stroke();

  // 요일, 시각
  ctx.fillStyle = IMG.MUTED;
  ctx.font = `500 22px ${family}`;
  ctx.textAlign = 'center';
  days.forEach((d, i) => ctx.fillText(DAY_LABEL[d], gx + IMG.TIME_W + colW * (i + 0.5), gy + 31));
  ctx.font = `400 18px ${family}`;
  ctx.textAlign = 'right';
  for (let m = from; m < to; m += 60) {
    ctx.fillText(String(m / 60), gx + IMG.TIME_W - 8, bodyY + ((m - from) / 60) * IMG.HOUR + 20);
  }
  ctx.textAlign = 'left';

  // 같이 비는 구간
  for (const s of segs) {
    const x = gx + IMG.TIME_W + colW * days.indexOf(s.day) + 4;
    const y = bodyY + ((toMin(s.start) - from) / 60) * IMG.HOUR + 1;
    const w = colW - 8;
    const h = ((toMin(s.end) - toMin(s.start)) / 60) * IMG.HOUR - 2;
    rrect(ctx, x, y, w, h, 8);
    ctx.fillStyle = IMG.SOFT;
    ctx.fill();
    ctx.strokeStyle = IMG.EDGE;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    rrect(ctx, x, y, w, h, 8);
    ctx.clip();
    drawSlotText(ctx, s, x, y, w, h, family);
    ctx.restore();
  }

  // 아래쪽 서비스 이름
  ctx.fillStyle = IMG.ACCENT;
  ctx.font = `700 26px ${family}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('공강메이트', IMG.PAD, H - 30);
  return canvas;
}

// 휴대폰: 공유 시트(카톡, 앨범 저장), 카톡 앱 안 브라우저 등: 이미지를 띄워 길게 눌러 저장, PC: 파일 저장
async function saveResultImage(r, title) {
  const canvas = buildResultImage(r, title);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const file = new File([blob], 'gonggang-result.png', { type: 'image/png' });
  const touch = window.matchMedia('(pointer: coarse)').matches;

  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // 사용자가 닫음
    }
  }
  const url = URL.createObjectURL(blob);
  if (touch || /KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp/i.test(navigator.userAgent)) {
    openImageModal(url);
    return;
  }
  const a = el('a', { href: url, download: 'gonggang-result.png' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function openImageModal(url) {
  removeModal();
  const box = el('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '결과 이미지',
    onclick: (e) => { if (e.target === box) closeDetail(); },
  }, [
    el('div', { class: 'modal-card image-card' }, [
      el('div', { class: 'modal-top' }, [
        el('h3', { text: '결과 이미지' }),
        el('button', { class: 'modal-close', type: 'button', 'aria-label': '닫기', onclick: closeDetail }, [icon('x', 18)]),
      ]),
      el('img', { src: url, alt: '공강 결과 이미지' }),
      el('p', { text: '이미지를 길게 눌러 저장해 주세요.' }),
    ]),
  ]);
  showModal(box);
}

// ---- 구간 상세 팝업 ----------------------------------------------------------
let detail = null;

function openDetail(s, me) {
  removeModal();
  const box = el('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '공강 상세',
    onclick: (e) => { if (e.target === box) closeDetail(); },
  }, [
    el('div', { class: 'modal-card' }, [
      el('div', { class: 'modal-top' }, [
        el('h3', { text: `${s.day_label}요일 ${s.start}–${s.end}` }),
        el('button', { class: 'modal-close', type: 'button', 'aria-label': '닫기', onclick: closeDetail }, [icon('x', 18)]),
      ]),
      el('p', { class: 'modal-sub', text: `${fmtMinutes(s.minutes)} · ${s.everyone ? `전원 ${s.count}명` : `${s.count}명`}` }),
      el('ul', { class: 'modal-names' }, s.names.map((n) => el('li', { class: n === me ? 'me' : '', text: n === me ? `${n} (나)` : n }))),
    ]),
  ]);
  showModal(box);
}

// 팝업도 기록 한 칸: 뒤로가기를 누르면 팝업만 닫힌다
function showModal(box) {
  document.body.append(box);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => box.classList.add('open'));
  detail = box;
  const entry = { step: state.step, mode: state.mode, modal: true };
  if (history.state && history.state.modal) history.replaceState(entry, '');
  else history.pushState(entry, '');
}

// 화면에서만 지운다 (기록은 그대로)
function removeModal() {
  if (!detail) return;
  const box = detail;
  detail = null;
  document.body.classList.remove('no-scroll');
  box.remove();
}

// 사용자가 닫을 때 (x, 바깥, Esc): 팝업이 만든 기록 한 칸도 같이 걷어낸다
function closeDetail() {
  if (!detail) return;
  const viaHistory = history.state && history.state.modal;
  removeModal();
  if (viaHistory) history.back();
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

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
    state.solo.result = await postJSON('/api/free', { members });
  } catch (err) {
    state.solo.result = null;
    state.solo.error = errText(err);
  }
}

function renderSolo() {
  const { members, result, error } = state.solo;
  $('#solo-sub').textContent = `${members.length}명 추가됨`;
  $('#solo-sub').hidden = !members.length;

  $('#solo-action').replaceChildren(el('button', {
    class: `btn ${members.length < 2 ? 'btn-primary' : 'btn-ghost'}`, type: 'button',
    text: '시간표 추가', disabled: members.length >= SOLO_MAX,
    onclick: () => { state.mode = 'solo'; state.joinFile = null; $('#join-name').value = ''; go('join'); },
  }));

  $('#solo-people').replaceChildren(...members.map((m, i) => el('li', {}, [
    m.name,
    el('span', { class: 'sub', text: `수업 ${m.classes.length}개` }),
    el('button', {
      type: 'button', 'aria-label': `${m.name} 빼기`, title: '빼기',
      onclick: async () => { members.splice(i, 1); await computeSolo(); renderSolo(); },
    }, [icon('x', 14)]),
  ])));

  const panel = $('#solo-result');
  if (error) {
    panel.replaceChildren(el('p', { class: 'error-text', text: error }));
  } else if (members.length < 2 || !result) {
    panel.replaceChildren(el('div', { class: 'empty-box' }, [
      el('strong', { text: members.length ? '한 명만 더 올려 주세요' : '시간표 캡처를 올려 보세요' }),
      el('p', { text: '2명 이상이면 같이 비는 시간이 보여요' }),
    ]));
  } else {
    renderResult(panel, result, null, '같이 비는 공강', '화면을 나가면 결과가 사라져요. 필요하면 이미지로 저장해 두세요.');
  }
}

async function addToSolo() {
  const d = state.draft;
  const problem = validateDraft();
  if (problem) return showReviewError(problem);
  const name = d.name.trim();
  const { members } = state.solo;
  if (members.some((m) => m.name === name)) return showReviewError(`이미 추가된 이름이에요: ${name}. 구분되는 이름으로 바꿔 주세요.`);
  if (members.length >= SOLO_MAX) return showReviewError(`한 번에 ${SOLO_MAX}명까지 비교할 수 있어요.`);
  const btn = $('#review-next');
  btn.disabled = true;
  btn.textContent = '비교 중...';
  members.push({ name, classes: d.classes.map(({ day, start, end }) => ({ day, start, end })) });
  state.joinFile = null;
  $('#join-name').value = '';
  await computeSolo();
  btn.disabled = false;
  finishFlow('solo');
}

// ---- 시간표 올리기 (그룹: 내 시간표, 혼자 비교하기: 여러 명) ------------------------------
function renderJoin() {
  const solo = state.mode === 'solo';
  const me = solo ? null : myName();
  $('#join-title').textContent = solo ? '시간표 추가' : me ? '내 시간표 다시 올리기' : '내 시간표 올리기';
  $('#join-name-label').textContent = solo ? '이름' : '내 이름';
  const nameInput = $('#join-name');
  nameInput.placeholder = solo ? '이 시간표 주인의 이름' : '친구들이 알아볼 이름';
  if (!nameInput.value && me) nameInput.value = me;
  $('#join-error').hidden = true;

  const preview = $('#join-preview');
  if (state.joinFile) {
    preview.src = URL.createObjectURL(state.joinFile);
    preview.hidden = false;
    $('#join-file-label').textContent = '다른 캡처로 바꾸기';
  } else {
    preview.hidden = true;
    $('#join-file-label').textContent = solo ? '시간표 캡처 선택' : '내 시간표 캡처 선택';
  }
  const btn = $('#join-next');
  btn.textContent = '인식하기';
  btn.disabled = !state.joinFile;
}

async function joinParse() {
  const name = $('#join-name').value.trim();
  if (!name) {
    const box = $('#join-error');
    box.textContent = '이름을 먼저 적어 주세요.';
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
    finishFlow('group');
  } catch (err) {
    if (err.code === 'NAME_TAKEN' && !mine) showNameConflict(d.name.trim());
    else showReviewError(err.code === 'NAME_TAKEN' ? `같은 이름을 다른 사람이 쓰고 있어요: ${d.name.trim()}` : errText(err));
  } finally {
    btn.disabled = false;
    btn.textContent = '그룹에 저장';
  }
}

// 같은 이름이 이미 있을 때: 본인(다른 기기에서 올렸던 나)인지, 다른 사람인지 묻는다
function showNameConflict(name) {
  const box = $('#review-error');
  box.replaceChildren(
    el('p', { text: `이 그룹에 같은 이름이 이미 있어요: ${name}` }),
    el('div', { class: 'conflict-actions' }, [
      el('button', {
        class: 'btn btn-primary btn-small', type: 'button', text: `내가 그 ${name} 맞아요 · 내 시간표로 바꾸기`,
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
  $('#review-next').textContent = state.mode === 'solo' ? '추가' : '그룹에 저장';
  if (!d) return;

  panel.append(el('h2', { class: 'page-title', text: '인식 결과 확인' }));
  panel.append(el('label', { class: 'field' }, [
    el('span', { text: state.mode === 'solo' ? '이름' : '내 이름' }),
    el('input', { id: 'review-name', value: d.name, maxlength: 20, placeholder: '이름', oninput: (e) => { d.name = e.target.value; } }),
  ]));

  if (d.status === 'error') {
    panel.append(el('div', { class: 'alert error', text: `${d.error} 다른 캡처로 다시 하거나 아래에서 직접 추가해 주세요.` }));
  }
  if (d.warnings.length) {
    panel.append(el('div', { class: 'alert' }, [
      el('p', { text: d.warnings.map((w) => w.message).join(' ') }),
      // 경고가 있을 때만: 캡처 맨 위 시각이 9시가 아니면 전체를 밀어 맞춘다
      el('div', { class: 'row-inline' }, [
        el('span', { class: 'sub', text: '시간표 시작 시각' }),
        el('select', {
          'aria-label': '시간표 시작 시각',
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
  if (!d.classes.length) list.append(el('li', { class: 'empty', text: '수업이 없어요. 수업 추가로 넣어 주세요.' }));
  for (const c of d.classes) list.append(classRow(d, c));
  panel.append(list);

  renderPreview(d);
}

function validateDraft() {
  const name = state.draft.name.trim();
  if (!name) return '이름을 적어 주세요.';
  if (name.length > 20) return '이름은 20자까지 쓸 수 있어요.';
  if (state.draft.classes.some((c) => !isValidClass(c))) return '끝나는 시각이 시작보다 빠른 수업이 있어요.';
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
$('#join-cancel').addEventListener('click', () => history.back());
$('#review-back').addEventListener('click', () => history.back());
$('#review-next').addEventListener('click', () => (state.mode === 'solo' ? addToSolo() : saveToGroup()));
$('#solo-start').addEventListener('click', startSolo);
$('#solo-home').addEventListener('click', () => go('home'));

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
