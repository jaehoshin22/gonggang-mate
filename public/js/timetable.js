'use strict';

// 주간 시간표 그리드와 공강 결과 그리기 (그룹·혼자 비교하기 공통).

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

// ---- 결과: 주간 시간표 각 칸에 같이 비는 사람 (30분 미만은 서버에서 제외) ----
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
