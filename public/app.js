'use strict';

// ---- 상수 ----------------------------------------------------------------
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_LABEL = { MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금', SAT: '토', SUN: '일' };
const GRID_START = 9 * 60;
const GRID_END = 18 * 60;
const MAX_UPLOAD = 4 * 1024 * 1024;
const PALETTE = ['#f28c8c', '#82b4f0', '#8ccda0', '#f5be6e', '#b496e1', '#6ec8c8', '#f0a0c8', '#c8be78'];

// ---- 상태 ----------------------------------------------------------------
const state = {
  step: 'upload',
  members: [],      // {id, name, file, preview, status, error, warnings, classes, gridStart}
  activeId: null,
  minMinutes: 60,
  result: null,
};
let nextId = 1;

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

function getMember(id) {
  return state.members.find((m) => m.id === id);
}

function newClass(member) {
  return {
    id: nextId++,
    day: 'MON',
    start: '09:00',
    end: '10:15',
    color: PALETTE[member.classes.length % PALETTE.length],
  };
}

// ---- 화면 전환 -------------------------------------------------------------
function go(step) {
  state.step = step;
  for (const name of ['upload', 'review', 'result']) {
    $(`#step-${name}`).hidden = name !== step;
  }
  const order = ['upload', 'review', 'result'];
  document.querySelectorAll('#steps li').forEach((li) => {
    const i = order.indexOf(li.dataset.step);
    li.classList.toggle('active', li.dataset.step === step);
    li.classList.toggle('done', i < order.indexOf(step));
  });
  if (step === 'upload') renderUpload();
  if (step === 'review') renderReview();
  window.scrollTo(0, 0);
}

// ---- 시간표 그리드 컴포넌트 --------------------------------------------------
// blocks: [{day, start, end, kind: 'class'|'free'|'partial', color, label}]
function renderTimetable(blocks, days = DAYS.slice(0, 5)) {
  const grid = el('div', { class: 'tt', style: { '--days': days.length } });
  grid.style.setProperty('--days', days.length);
  grid.append(el('div', { class: 'tt-head' }));
  for (const d of days) grid.append(el('div', { class: 'tt-head', text: DAY_LABEL[d] }));

  const times = el('div', { class: 'tt-times' });
  for (let h = 9; h < 18; h++) {
    times.append(el('span', { text: String(h), style: { top: `${((h * 60 - GRID_START) / (GRID_END - GRID_START)) * 100}%` } }));
  }
  grid.append(times);

  for (const d of days) {
    const col = el('div', { class: 'tt-col' });
    for (const b of blocks.filter((x) => x.day === d)) {
      const s = Math.max(toMin(b.start), GRID_START);
      const e = Math.min(toMin(b.end), GRID_END);
      if (!(s < e)) continue;
      const total = GRID_END - GRID_START;
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

// ---- 1단계: 업로드 (F3) ------------------------------------------------------
function addMember(file) {
  const index = state.members.length;
  state.members.push({
    id: nextId++,
    name: index === 0 ? '나' : `친구${index}`,
    file: file || null,
    preview: file ? URL.createObjectURL(file) : null,
    status: file ? 'idle' : 'manual',
    error: null,
    warnings: [],
    classes: [],
    gridStart: 9,
  });
}

function removeMember(id) {
  const m = getMember(id);
  if (m && m.preview) URL.revokeObjectURL(m.preview);
  state.members = state.members.filter((x) => x.id !== id);
  renderUpload();
}

const STATUS_TEXT = {
  idle: '인식 전',
  parsing: '인식 중...',
  done: '인식 완료',
  error: '인식 실패 · 직접 입력 가능',
  manual: '직접 입력',
};

function renderUpload() {
  const list = $('#member-cards');
  list.replaceChildren();
  for (const m of state.members) {
    list.append(el('li', { class: 'member-card' }, [
      m.preview
        ? el('img', { class: 'thumb', src: m.preview, alt: `${m.name} 시간표 캡처` })
        : el('div', { class: 'thumb', text: '직접' }),
      el('div', {}, [
        el('input', {
          value: m.name,
          'aria-label': '이름',
          maxlength: 12,
          oninput: (e) => { m.name = e.target.value; },
        }),
        el('div', { class: `status ${m.status}`, text: m.error || STATUS_TEXT[m.status] }),
      ]),
      el('button', { class: 'icon-btn danger', type: 'button', text: '삭제', onclick: () => removeMember(m.id) }),
    ]));
  }
  const pending = state.members.filter((m) => m.file && m.status !== 'done').length;
  const btn = $('#start-parse');
  btn.disabled = state.members.length === 0;
  btn.textContent = pending ? `시간표 인식하기 (${pending}장)` : '다음';
}

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
  renderUpload();
  try {
    const body = await prepareUpload(m.file);
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': body.type || 'application/octet-stream' },
      body,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error.message);
    m.classes = data.classes.map((c) => ({ ...c, id: nextId++ }));
    m.warnings = data.warnings;
    m.status = 'done';
  } catch (err) {
    m.status = 'error';
    m.error = err instanceof TypeError ? '서버에 연결하지 못했습니다.' : err.message;
    m.classes = [];
    m.warnings = [];
  }
  renderUpload();
}

async function parseAll() {
  const btn = $('#start-parse');
  btn.disabled = true;
  const targets = state.members.filter((m) => m.file && m.status !== 'done');
  await Promise.all(targets.map(parseMember)); // 한 장씩 따로 요청, 동시에 보냄
  state.activeId = state.members[0].id;
  go('review');
}

// ---- 2단계: 확인·수정 (F2) ----------------------------------------------------
function renderTabs() {
  const tabs = $('#member-tabs');
  tabs.replaceChildren();
  for (const m of state.members) {
    const needsCheck = m.warnings.length > 0 || m.status === 'error';
    tabs.append(el('button', {
      type: 'button',
      role: 'tab',
      class: m.id === state.activeId ? 'active' : '',
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
  const daySelect = el('select', { 'aria-label': '요일', onchange: update('day') },
    DAYS.map((d) => el('option', { value: d, selected: d === c.day, text: `${DAY_LABEL[d]}요일` })));
  row.append(
    el('span', { class: 'swatch', style: { background: c.color } }),
    daySelect,
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
  const m = getMember(state.activeId);
  if (!m) {
    panel.append(el('p', { class: 'empty', text: '먼저 시간표를 추가해 주세요.' }));
    return;
  }

  if (m.status === 'error') {
    panel.append(el('div', { class: 'alert error', text: `${m.error} 아래에서 수업을 직접 추가할 수 있습니다.` }));
  }
  if (m.warnings.length) {
    panel.append(el('div', { class: 'alert' }, [
      el('ul', {}, m.warnings.map((w) => el('li', { text: w.message }))),
    ]));
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
  if (!m.classes.length) list.append(el('li', { class: 'empty', text: '수업이 없습니다. 이 사람은 모든 요일이 비어 있는 것으로 계산합니다.' }));
  for (const c of m.classes) list.append(classRow(m, c));
  panel.append(list);

  renderPreview(m);
}

function validateBeforeFree() {
  const names = state.members.map((m) => m.name.trim());
  if (!state.members.length) return '시간표를 한 장 이상 추가해 주세요.';
  if (names.some((n) => !n)) return '이름이 비어 있는 사람이 있습니다. 1단계에서 이름을 적어 주세요.';
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

// ---- 3단계: 공강 결과 (F4, F5, F6) --------------------------------------------
async function findFree() {
  const panel = $('#result-panel');
  panel.replaceChildren(el('p', { class: 'loading', text: '공강을 찾는 중...' }));
  document.querySelectorAll('#min-chips button').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.min) === state.minMinutes);
    b.setAttribute('aria-checked', Number(b.dataset.min) === state.minMinutes);
  });
  try {
    const res = await fetch('/api/free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        min_minutes: state.minMinutes,
        members: state.members.map((m) => ({
          name: m.name.trim(),
          classes: m.classes.map(({ day, start, end }) => ({ day, start, end })),
        })),
      }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error.message);
    state.result = data;
    renderResult();
  } catch (err) {
    panel.replaceChildren(el('p', {
      class: 'error-text',
      text: err instanceof TypeError ? '서버에 연결하지 못했습니다.' : err.message,
    }));
  }
}

function renderResult() {
  const r = state.result;
  const panel = $('#result-panel');
  panel.replaceChildren();
  const showPartial = r.common.length === 0 && r.partial.length > 0;

  const totalMin = r.common.reduce((sum, s) => sum + s.minutes, 0);
  panel.append(el('p', {
    class: 'summary',
    text: r.common.length
      ? `${r.member_count}명이 함께 비는 시간 ${r.common.length}개 · 합계 ${Math.floor(totalMin / 60)}시간 ${totalMin % 60}분`
      : `${r.min_minutes}분 이상 ${r.member_count}명이 모두 비는 시간이 없습니다.`,
  }));

  const blocks = r.common.map((s) => ({ ...s, kind: 'free', label: `${s.start}` }));
  if (showPartial) {
    for (const s of r.partial) blocks.push({ ...s, kind: 'partial', label: `${s.missing[0]} 빠짐` });
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
      el('span', { class: 'sub', text: `${r.member_count}명 중 ${r.member_count - 1}명 가능 · ${s.missing[0]} 빠짐` }),
    ])));
    if (showPartial) {
      panel.append(el('h2', { class: 'section-title', text: '차선 시간 (한 명만 빠짐)' }), list);
    } else {
      panel.append(el('details', {}, [
        el('summary', { class: 'section-title', text: `차선 시간도 보기 (${r.partial.length})` }),
        list,
      ]));
    }
  } else if (!r.common.length && r.member_count >= 3) {
    panel.append(el('p', { class: 'empty', text: '한 명만 빠지는 시간도 없습니다. 최소 시간을 줄여 보세요.' }));
  }
}

// ---- 이벤트 연결 -----------------------------------------------------------
$('#file-input').addEventListener('change', (e) => {
  for (const file of e.target.files) addMember(file);
  e.target.value = '';
  renderUpload();
});

$('#add-manual').addEventListener('click', () => {
  addMember(null);
  renderUpload();
});

$('#start-parse').addEventListener('click', parseAll);

$('#find-free').addEventListener('click', () => {
  const problem = validateBeforeFree();
  if (problem) {
    renderReview();
    const box = $('#review-error');
    box.textContent = problem;
    box.hidden = false;
    return;
  }
  go('result');
  findFree();
});

$('#min-chips').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-min]');
  if (!btn) return;
  state.minMinutes = Number(btn.dataset.min);
  findFree();
});

document.querySelectorAll('[data-go]').forEach((btn) => {
  btn.addEventListener('click', () => go(btn.dataset.go));
});

go('upload');
