'use strict';

// 시간표 캡처 인식 요청: 큰 사진은 줄여서 /api/parse 로 보내고, 결과 초안을 만든다.

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
