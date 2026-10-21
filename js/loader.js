// ============================================================
// 写真の読み込み
// ・Exifの向きを補正し、長辺 MAX_LONG_EDGE に縮小した正立Canvasとして保持する
// ・以後は正立したCanvasだけを扱う
// ・外部への送信は一切しない
// ============================================================

// 返り値: { canvas, w, h, name, info }  info は実機確認用の診断文字列
async function loadPhoto(file) {
  const buf = await file.arrayBuffer();
  const jpeg = parseJpegHeader(buf); // JPEG以外は null
  const img = await decodeImage(file);

  const nw = img.naturalWidth, nh = img.naturalHeight;
  const orientation = jpeg ? jpeg.orientation : 1;

  // ブラウザがExifの向きを既に適用したかを、生の画素寸法と比べて判定する。
  // 向き5〜8（90°系）で、デコード結果が生の寸法のままなら未適用。
  let needManual = false;
  if (jpeg && orientation >= 5 && orientation <= 8 && jpeg.width) {
    needManual = (nw === jpeg.width && nh === jpeg.height && nw !== nh);
  } else if (jpeg && (orientation === 2 || orientation === 3 || orientation === 4)) {
    // 180°系は寸法から判定できない。現行Safariは適用済みなので手動補正しない。
    needManual = false;
  }

  const canvas = drawUpright(img, needManual ? orientation : 1);

  const info = [
    file.name || '(no name)',
    `type=${file.type || '?'} size=${(file.size / 1024 / 1024).toFixed(2)}MB`,
    `exif向き=${jpeg ? orientation : '(JPEG以外)'}` +
      (jpeg && jpeg.width ? ` 生寸法=${jpeg.width}×${jpeg.height}` : ''),
    `デコード=${nw}×${nh} 手動補正=${needManual ? 'あり' : 'なし'}`,
    `保持=${canvas.width}×${canvas.height}`,
  ].join('\n');

  return { canvas, w: canvas.width, h: canvas.height, name: file.name, info };
}

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`デコード失敗（type=${file.type || '?'}）。HEICの場合はこのブラウザで表示できない形式の可能性`));
    };
    img.src = url;
  });
}

// 向き補正＋長辺縮小して正立Canvasに描く
function drawUpright(img, orientation) {
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const rotated = orientation >= 5 && orientation <= 8;
  const uw = rotated ? sh : sw, uh = rotated ? sw : sh; // 正立後の寸法
  const k = Math.min(1, CONFIG.PHOTO.MAX_LONG_EDGE / Math.max(uw, uh));
  const cw = Math.round(uw * k), ch = Math.round(uh * k);

  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  // 描画先寸法（回転前の座標系）
  const dw = Math.round(sw * k), dh = Math.round(sh * k);
  switch (orientation) {
    case 2: ctx.setTransform(-1, 0, 0, 1, cw, 0); break;
    case 3: ctx.setTransform(-1, 0, 0, -1, cw, ch); break;
    case 4: ctx.setTransform(1, 0, 0, -1, 0, ch); break;
    case 5: ctx.setTransform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.setTransform(0, 1, -1, 0, cw, 0); break;
    case 7: ctx.setTransform(0, -1, -1, 0, cw, ch); break;
    case 8: ctx.setTransform(0, -1, 1, 0, 0, ch); break;
    default: break;
  }
  ctx.drawImage(img, 0, 0, dw, dh);
  return c;
}

// JPEGのヘッダだけを読み、Exif向きと生の画素寸法を得る
function parseJpegHeader(buf) {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
  const out = { orientation: 1, width: 0, height: 0 };
  let p = 2;
  while (p + 4 <= v.byteLength) {
    if (v.getUint8(p) !== 0xFF) break;
    const marker = v.getUint8(p + 1);
    if (marker === 0xD9 || marker === 0xDA) break; // EOI / SOS
    const len = v.getUint16(p + 2);
    if (marker === 0xE1 && v.getUint32(p + 4) === 0x45786966) { // "Exif"
      out.orientation = readExifOrientation(v, p + 10) || 1;
    }
    const isSOF = marker >= 0xC0 && marker <= 0xCF &&
      marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (isSOF && !out.width) {
      out.height = v.getUint16(p + 5);
      out.width = v.getUint16(p + 7);
    }
    p += 2 + len;
  }
  return out;
}

function readExifOrientation(v, tiff) {
  if (tiff + 8 > v.byteLength) return 0;
  const le = v.getUint16(tiff) === 0x4949;
  const ifd = tiff + v.getUint32(tiff + 4, le);
  if (ifd + 2 > v.byteLength) return 0;
  const count = v.getUint16(ifd, le);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > v.byteLength) return 0;
    if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
  }
  return 0;
}
