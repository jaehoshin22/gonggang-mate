'use strict';

// 공강 결과를 PNG 이미지로 그려서 저장·공유한다 (canvas).

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
  const maxW = w - 20;
  const maxLines = Math.max(1, Math.floor((h - 8) / IMG.LINE));
  const style = {
    count: { font: `700 20px ${family}`, color: IMG.ACCENT },
    name: { font: `500 21px ${family}`, color: IMG.INK },
    more: { font: `500 20px ${family}`, color: IMG.MUTED },
  };
  // 화면과 같은 모양: 첫 줄에 인원 수, 아래로 이름을 한 줄에 하나씩. 모자라면 마지막 줄에 '외 K명'
  const room = maxLines - 1;
  const shown = s.names.length <= room ? s.names : s.names.slice(0, Math.max(room - 1, 0));
  const rest = s.names.length - shown.length;
  const lines = [{ t: `${s.count}명`, kind: 'count' }, ...shown.map((n) => ({ t: n, kind: 'name' }))];
  if (rest && maxLines > 1) lines.push({ t: `외 ${rest}명`, kind: 'more' });

  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, i) => {
    ctx.font = style[line.kind].font;
    ctx.fillStyle = style[line.kind].color;
    ctx.fillText(fitText(ctx, line.t, maxW), x + 10, y + 6 + IMG.LINE * i + 19);
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
