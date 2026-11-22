'use strict';

// 확인·수정 화면: 인식 결과 미리보기와 수업 추가·수정·삭제. 검증은 errors.js.

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
  const row = el('li', { class: `class-row ${rowInvalid(d, c) ? 'invalid' : ''}` });
  const update = (key) => (e) => {
    c[key] = e.target.value;
    row.classList.toggle('invalid', rowInvalid(d, c));
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
  const friend = state.mode === 'solo' && state.solo.adding === 'friend';
  const q = friend ? state.queue : null;
  const more = !!q && state.queueIndex < q.length - 1;
  $('#review-next').textContent = state.mode !== 'solo' ? '그룹에 저장' : friend && more ? '다음' : '추가';
  $('#review-back').textContent = friend ? '취소' : '이전';
  if (!d) return;

  const title = q && q.length > 1 ? `인식 결과 확인 (${state.queueIndex + 1}/${q.length})` : '인식 결과 확인';
  panel.append(q && q.length > 1
    ? el('div', { class: 'row-inline review-head' }, [
      el('h2', { class: 'page-title', text: title }),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: '건너뛰기', onclick: skipDraft }),
    ])
    : el('h2', { class: 'page-title', text: title }));
  panel.append(el('label', { class: 'field' }, [
    el('span', { text: friend ? '친구 이름' : '내 이름' }),
    el('input', { id: 'review-name', value: d.name, maxlength: 20, placeholder: friend ? '친구 이름' : '이름', oninput: (e) => { d.name = e.target.value; } }),
  ]));

  if (d.preview) {
    panel.append(el('button', { class: 'source-thumb', type: 'button', onclick: () => openCapture(d.preview, '원본 캡처') }, [
      el('img', { src: d.preview, alt: '원본 캡처' }),
      el('span', { text: '원본 캡처 · 누르면 크게 보여요' }),
    ]));
  }

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

  if (d.overlaps && d.overlaps.size) {
    panel.append(el('p', { id: 'overlap-msg', class: 'field-error', role: 'alert', text: '시간이 겹치는 수업이 있어요.' }));
  }
  const list = el('ul', { class: 'class-list' });
  if (!d.classes.length) list.append(el('li', { class: 'empty', text: '수업이 없어요. 수업 추가로 넣어 주세요.' }));
  for (const c of d.classes) list.append(classRow(d, c));
  panel.append(list);

  renderPreview(d);
}
