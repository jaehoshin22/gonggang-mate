'use strict';

// 시간표 올리기 화면: 내 시간표(그룹) 또는 친구 캡처 여러 장(혼자 비교하기)을 받아 인식한다.

// ---- 시간표 올리기 (그룹: 내 시간표, 혼자 비교하기: 여러 명) ------------------------------
// ---- 친구 시간표: 캡처를 여러 장 고르면 카드(썸네일 + 이름)가 생긴다 ----------------------
let cardSeq = 1;
function clearCards() {
  state.friendCards.forEach((c) => URL.revokeObjectURL(c.preview));
  state.friendCards = [];
}

// 추가가 끝난(또는 건너뛴) 장은 카드 목록에서 뺀다: 확인 화면에서 이전으로 돌아와도 남은 장만 보이게
function removeCard(id) {
  const card = state.friendCards.find((c) => c.id === id);
  if (!card) return;
  URL.revokeObjectURL(card.preview);
  state.friendCards = state.friendCards.filter((c) => c !== card);
}

function addCards(files) {
  const room = SOLO_MAX - state.solo.members.length - state.friendCards.length;
  const take = files.slice(0, Math.max(room, 0));
  take.forEach((file) => state.friendCards.push({ id: cardSeq++, file, preview: URL.createObjectURL(file), name: '' }));
  return take.length < files.length ? `한 번에 ${SOLO_MAX}명까지 비교할 수 있어요.` : null;
}

function renderCards() {
  const list = $('#join-cards');
  const cards = state.friendCards;
  list.hidden = !cards.length;
  list.replaceChildren(...cards.map((card) => el('li', { class: 'friend-card' }, [
    el('button', { class: 'thumb-btn', type: 'button', 'aria-label': '캡처 크게 보기', onclick: () => openCapture(card.preview, '친구 시간표 캡처') }, [
      el('img', { src: card.preview, alt: '' }),
    ]),
    el('input', {
      value: card.name, maxlength: 20, placeholder: '친구 이름', 'aria-label': '친구 이름',
      oninput: (e) => { card.name = e.target.value; $('#join-error').hidden = true; },
    }),
    el('button', {
      class: 'icon-btn', type: 'button', 'aria-label': '이 캡처 빼기', title: '빼기',
      onclick: () => { URL.revokeObjectURL(card.preview); state.friendCards = state.friendCards.filter((c) => c !== card); renderJoin(); },
    }, [icon('x', 16)]),
  ])));
}

function renderJoin() {
  const friend = state.mode === 'solo' && state.solo.adding === 'friend'; // 혼자 비교하기에서 친구 시간표를 올리는 중
  const me = state.mode === 'solo' ? (friend ? null : (soloMe() || {}).name || null) : myName();
  $('#join-title').textContent = friend ? '친구 시간표 추가' : me ? '내 시간표 다시 올리기' : '내 시간표 올리기';
  $('#join-name-label').textContent = '내 이름';
  const nameInput = $('#join-name');
  $('#join-name-field').hidden = friend; // 친구는 캡처를 먼저 받고, 이름은 카드에서 적는다
  $('#join-file').multiple = friend;
  $('#join-file-sub').textContent = friend ? '여러 장을 한 번에 골라도 돼요' : '에브리타임 시간표 탭을 캡처해서 올려 주세요';
  nameInput.placeholder = state.mode === 'solo' ? '내 이름' : '친구들이 알아볼 이름';
  if (!nameInput.value && me) nameInput.value = me;
  $('#join-error').hidden = true;

  const preview = $('#join-preview');
  const btn = $('#join-next');
  if (friend) {
    preview.hidden = true;
    renderCards();
    $('#join-file-label').textContent = state.friendCards.length ? '캡처 더 추가' : '친구 시간표 캡처 선택';
    btn.textContent = '추가';
    btn.disabled = !state.friendCards.length;
    return;
  }
  $('#join-cards').hidden = true;
  if (state.joinFile) {
    preview.src = URL.createObjectURL(state.joinFile);
    preview.hidden = false;
    $('#join-file-label').textContent = '다른 캡처로 바꾸기';
  } else {
    preview.hidden = true;
    $('#join-file-label').textContent = '내 시간표 캡처 선택';
  }
  btn.textContent = '인식하기';
  btn.disabled = !state.joinFile;
}

async function joinParse() {
  if (state.mode === 'solo' && state.solo.adding === 'friend') return joinParseFriends();
  const name = $('#join-name').value.trim();
  if (!name) {
    $('#join-error').hidden = true;
    markFieldError($('#join-name'), '이름을 먼저 적어 주세요.');
    return;
  }
  const btn = $('#join-next');
  btn.disabled = true;
  btn.textContent = '인식 중...';
  state.draft = { name, status: 'parsing', error: null, warnings: [], classes: [], gridStart: 9 };
  await parseDraft(state.draft, state.joinFile);
  go('review');
}

// 친구 시간표: 카드마다 이름을 받고, 캡처를 차례로 인식한다.
// 문제없이 읽힌 시간표는 바로 추가하고, 경고나 실패가 있는 것만 확인 화면에서 고친다
async function joinParseFriends() {
  const cards = state.friendCards;
  const box = $('#join-error');
  const inputs = [...document.querySelectorAll('#join-cards input')];
  box.hidden = true;
  const fail = (message, input) => markFieldError(input, message);
  const names = cards.map((c) => c.name.trim());
  const empty = names.findIndex((n) => !n);
  if (empty >= 0) return fail('이름을 적어 주세요.', inputs[empty]);
  const dup = names.findIndex((n, i) => names.indexOf(n) !== i || state.solo.members.some((m) => m.name === n));
  if (dup >= 0) return fail(dupNameMessage(names[dup]), inputs[dup]);

  const btn = $('#join-next');
  btn.disabled = true;
  const { members } = state.solo;
  const needReview = [];
  for (let i = 0; i < cards.length; i += 1) {
    btn.textContent = cards.length > 1 ? `인식 중 ${i + 1}/${cards.length}` : '인식 중...';
    const d = { name: names[i], status: 'parsing', error: null, warnings: [], classes: [], gridStart: 9, preview: cards[i].preview, cardId: cards[i].id };
    await parseDraft(d, cards[i].file);
    if (d.status === 'done' && !d.warnings.length && d.classes.length && !findOverlaps(d.classes).size) {
      members.push({ name: d.name, classes: d.classes.map(({ day, start, end }) => ({ day, start, end })) });
      removeCard(d.cardId);
    } else {
      needReview.push(d);
    }
  }
  await computeSolo();
  if (!needReview.length) {
    clearCards();
    history.back(); // 올리기 화면 한 칸만 걷어내고 혼자 비교하기 결과로
    return;
  }
  state.queue = needReview;
  state.queueIndex = 0;
  state.draft = needReview[0];
  go('review');
}
