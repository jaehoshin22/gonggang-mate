'use strict';

// 팝업: 구간 상세, 캡처 크게 보기, 결과 이미지 보기. 팝업도 기록 한 칸이라 뒤로가기로 닫힌다.

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

// 캡처 크게 보기: 뒤 화면은 어둡게, 바깥·X·뒤로가기·Esc로 닫힘
function openCapture(src, alt) {
  removeModal();
  const box = el('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': alt,
    onclick: (e) => { if (e.target === box) closeDetail(); },
  }, [
    el('div', { class: 'modal-card image-card capture-card' }, [
      el('div', { class: 'modal-top' }, [
        el('h3', { text: alt }),
        el('button', { class: 'modal-close', type: 'button', 'aria-label': '닫기', onclick: closeDetail }, [icon('x', 18)]),
      ]),
      el('img', { src, alt }),
    ]),
  ]);
  showModal(box);
}
