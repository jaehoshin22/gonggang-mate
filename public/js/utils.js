'use strict';

// 여러 화면이 함께 쓰는 범용 도구: DOM 만들기, 시간 변환, 아이콘, 서버 요청, 기기 저장소.

// ---- DOM·시간·표시 ----

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

// ---- 서버 요청 ----

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

// ---- 이 기기 저장소 ----

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
