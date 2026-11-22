'use strict';

// 예외 처리(화면 쪽): 겹치는 수업, 같은 이름, 입력 검증, 오류 표시를 한곳에 모았다.
// 서버 쪽 예외 처리는 core/handlers.py (상태 코드로 변환) 와 core/group.py (이름 규칙).

// ---- 수업 시간 검사 ----

// 같은 요일에서 시간이 겹치는 수업들(이어 붙는 것은 겹침이 아님)
function findOverlaps(classes) {
  const ok = classes.filter(isValidClass);
  const bad = new Set();
  for (let i = 0; i < ok.length; i += 1) {
    for (let j = i + 1; j < ok.length; j += 1) {
      const a = ok[i];
      const b = ok[j];
      if (a.day === b.day && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end)) { bad.add(a); bad.add(b); }
    }
  }
  return bad;
}
const rowInvalid = (d, c) => !isValidClass(c) || Boolean(d.overlaps && d.overlaps.has(c));
const isValidClass = (c) => DAYS.includes(c.day) && toMin(c.start) < toMin(c.end);

// ---- 이름 중복 안내 문구 ----

const dupNameMessage = (name) => `이미 있는 이름이에요. 다른 이름으로 바꿔 주세요. (예: ${name}B)`;

// ---- 입력 칸 오류 표시 (테두리 + 한 줄 안내) ----

// 이름 칸 오류: 테두리를 빨갛게 하고 칸 바로 아래에 한 줄로 알린다. 다시 입력하면 사라진다
function markFieldError(input, message) {
  clearFieldError(input);
  input.classList.add('invalid');
  input.setAttribute('aria-invalid', 'true');
  input.insertAdjacentElement('afterend', el('p', { class: 'field-error', role: 'alert', text: message }));
  input.focus();
}
function clearFieldError(input) {
  input.classList.remove('invalid');
  input.removeAttribute('aria-invalid');
  const next = input.nextElementSibling;
  if (next && next.classList.contains('field-error')) next.remove();
}
document.addEventListener('input', (e) => {
  if (e.target.classList && e.target.classList.contains('invalid')) clearFieldError(e.target);
});

// ---- 확인 화면 검증과 오류 표시 ----

function validateDraft() {
  const name = state.draft.name.trim();
  if (!name) return { field: 'name', message: '이름을 적어 주세요.' };
  if (name.length > 20) return { field: 'name', message: '이름은 20자까지 쓸 수 있어요.' };
  state.draft.overlaps = null;
  if (state.draft.classes.some((c) => !isValidClass(c))) return { message: '끝나는 시각이 시작보다 빠른 수업이 있어요.' };
  const overlaps = findOverlaps(state.draft.classes);
  if (overlaps.size) {
    state.draft.overlaps = overlaps; // 겹치는 줄을 빨갛게 표시하고, 고치기 전에는 다음으로 넘어가지 않는다
    return { field: 'overlap', message: '시간이 겹치는 수업이 있어요.' };
  }
  return null;
}

function showReviewError(message) {
  renderReview();
  const box = $('#review-error');
  box.replaceChildren(el('p', { text: message }));
  box.hidden = false;
}

// 확인 화면의 문제: 이름 문제는 이름 칸에, 나머지는 오류 영역에 보여 준다

function showProblem(problem) {
  if (problem.field === 'overlap') {
    renderReview();
    const msg = $('#overlap-msg');
    if (msg) msg.scrollIntoView({ block: 'center' });
    return;
  }
  if (problem.field !== 'name') return showReviewError(problem.message);
  $('#review-error').hidden = true;
  markFieldError($('#review-name'), problem.message);
}
