// AI sonucundaki yüzleri, orijinal fotoğraftaki yüz pikselleriyle değiştirir.
// Böylece yüz AI tarafından yeniden çizilmez; orijinal yüz birebir korunur.
// Tamamen tarayıcıda çalışır (MediaPipe Face Landmarker, dosyalar /public/mediapipe altında).

let lmPromise;
function getLandmarker() {
  if (!lmPromise) {
    lmPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe');
      const lm = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 10,
      });
      return { lm, oval: FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.map(c => c.start) };
    })().catch(e => { lmPromise = null; throw e; });
  }
  return lmPromise;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Görsel yüklenemedi.'));
    img.src = src;
  });
}

// En küçük kareler benzerlik dönüşümü (ölçek + döndürme + öteleme): src → dst
function fitSimilarity(src, dst) {
  const n = src.length;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let a = 0, b = 0, d = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i][0] - sx, py = src[i][1] - sy, qx = dst[i][0] - dx, qy = dst[i][1] - dy;
    a += px * qx + py * qy; b += px * qy - py * qx; d += px * px + py * py;
  }
  const c = a / d, s = b / d;
  // canvas matrisi: x' = c*x - s*y + e ; y' = s*x + c*y + f
  return [c, s, -s, c, dx - (c * sx - s * sy), dy - (s * sx + c * sy)];
}

const center = f => f.reduce((m, p) => [m[0] + p.x / f.length, m[1] + p.y / f.length], [0, 0]);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function supportsFilter() {
  const g = canvas(1, 1).getContext('2d');
  g.filter = 'blur(2px)';
  return g.filter === 'blur(2px)';
}

// Yüz ovalini, kenarları yumuşatılmış bir maske olarak çiz (orijinal koordinatlarda, T ile)
function drawMask(m, T, poly, featherPx, k0 = 0.97) {
  const g = m.getContext('2d');
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  const path = k => {
    g.beginPath();
    poly.forEach(([x, y], i) => {
      const X = cx + (x - cx) * k, Y = cy + (y - cy) * k;
      i ? g.lineTo(X, Y) : g.moveTo(X, Y);
    });
    g.closePath();
  };
  g.fillStyle = '#fff';
  if (supportsFilter()) {
    g.setTransform(...T);
    g.filter = `blur(${featherPx}px)`;
    path(k0); g.fill();
  } else {
    g.setTransform(...T);
    const N = 10;
    g.globalAlpha = 0.3;
    for (let i = 0; i < N; i++) { path(k0 + 0.05 - 0.12 * (i / (N - 1))); g.fill(); }
  }
}

// Küçük yüzleri de bulmak için: önce tüm görsel, sonra büyütülmüş parçalar (2x2, 3x3)
function detectAll(lm, img) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const faces = [];
  const bbox = f => {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const p of f) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 };
  };
  const add = f => {
    const b = bbox(f);
    if (faces.some(g => { const c = bbox(g); return Math.hypot(c.cx - b.cx, c.cy - b.cy) < Math.max(c.w, b.w) * 0.6; })) return;
    faces.push(f);
  };
  (lm.detect(img).faceLandmarks || []).forEach(add);
  for (const n of [2, 3]) {
    const tw = W / n * 1.5, th = H / n * 1.5;
    const k = Math.min(4, 768 / Math.max(tw, th));
    const c = canvas(Math.round(tw * k), Math.round(th * k));
    const g = c.getContext('2d');
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const tx = Math.min(W - tw, Math.max(0, (W - tw) * (n === 1 ? 0 : i / (n - 1))));
      const ty = Math.min(H - th, Math.max(0, (H - th) * (n === 1 ? 0 : j / (n - 1))));
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(img, tx, ty, tw, th, 0, 0, c.width, c.height);
      for (const f of lm.detect(c).faceLandmarks || []) {
        const b = bbox(f);
        if (b.x0 < 0.02 || b.y0 < 0.02 || b.x1 > 0.98 || b.y1 > 0.98) continue; // parça kenarında kesik yüz
        add(f.map(p => ({ x: (tx + p.x * tw) / W, y: (ty + p.y * th) / H, z: p.z })));
      }
    }
  }
  return faces;
}

/**
 * @param {string} origSrc  orijinal fotoğraf (data URL)
 * @param {string} outSrc   AI sonucu (data URL)
 * @returns {Promise<{image: string, faces: number, matched: number}>}
 */
export async function restoreFaces(origSrc, outSrc) {
  const [o, r] = await Promise.all([loadImage(origSrc), loadImage(outSrc)]);
  const { lm, oval } = await getLandmarker();
  const fo = detectAll(lm, o);
  const fr = detectAll(lm, r);
  const ow = o.naturalWidth, oh = o.naturalHeight, W = r.naturalWidth, H = r.naturalHeight;
  if (!fo.length) return { image: outSrc, faces: 0, matched: 0 };

  const out = canvas(W, H);
  const ctx = out.getContext('2d');
  ctx.drawImage(r, 0, 0);

  // Yüzleri eşleştir: sayılar aynıysa soldan sağa sırayla, değilse en yakın merkez
  const pairs = [];
  if (fo.length === fr.length) {
    const so = fo.map((f, i) => [center(f)[0], i]).sort((a, b) => a[0] - b[0]);
    const sr = fr.map((f, i) => [center(f)[0], i]).sort((a, b) => a[0] - b[0]);
    so.forEach((x, k) => pairs.push([fo[x[1]], fr[sr[k][1]]]));
  } else {
    const used = new Set();
    for (const f of fo) {
      const c = center(f);
      let best = -1, bestD = 0.25;
      fr.forEach((g, j) => {
        if (used.has(j)) return;
        const k = center(g), dd = Math.hypot(k[0] - c[0], k[1] - c[1]);
        if (dd < bestD) { bestD = dd; best = j; }
      });
      if (best >= 0) { used.add(best); pairs.push([f, fr[best]]); }
    }
  }

  const width = (pts) => { const xs = pts.map(p => p[0]); return Math.max(...xs) - Math.min(...xs); };
  let matched = 0;
  for (const [f, g] of pairs) {
    const P = f.map(p => [p.x * ow, p.y * oh]);
    const Q = g.map(p => [p.x * W, p.y * H]);
    const T = fitSimilarity(P, Q);
    const scale = Math.hypot(T[0], T[1]);
    const poly = oval.map(i => P[i]);
    const polyR = oval.map(i => Q[i]);
    // Güvenlik: yüz boyutu AI sonucundaki yüzle uyuşmuyorsa yapıştırma (kafa büyümesin)
    const ratio = (width(poly) * scale) / width(polyR);
    if (!(ratio > 0.9 && ratio < 1.1)) continue;
    matched++;

    const feather = Math.max(2, width(polyR) * 0.05);
    const layer = canvas(W, H), lg = layer.getContext('2d');
    lg.setTransform(...T);
    lg.drawImage(o, 0, 0);
    lg.setTransform(1, 0, 0, 1, 0, 0);
    const mask = canvas(W, H);
    // Maskeyi AI yüzünün biraz içinde tut, böylece kenarlar AI kafasının dışına taşmaz
    drawMask(mask, T, poly, feather, 0.92);
    lg.globalCompositeOperation = 'destination-in';
    lg.drawImage(mask, 0, 0);
    ctx.drawImage(layer, 0, 0);
  }
  if (!matched) return { image: outSrc, faces: fo.length, matched: 0 };
  return { image: out.toDataURL('image/png'), faces: fo.length, matched };
}
