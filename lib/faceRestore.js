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
function drawMask(m, T, poly, featherPx) {
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
    path(0.97); g.fill();
  } else {
    g.setTransform(...T);
    const N = 10;
    g.globalAlpha = 0.3;
    for (let i = 0; i < N; i++) { path(1.02 - 0.12 * (i / (N - 1))); g.fill(); }
  }
}

/**
 * @param {string} origSrc  orijinal fotoğraf (data URL)
 * @param {string} outSrc   AI sonucu (data URL)
 * @returns {Promise<{image: string, faces: number, matched: number}>}
 */
export async function restoreFaces(origSrc, outSrc) {
  const [o, r] = await Promise.all([loadImage(origSrc), loadImage(outSrc)]);
  const { lm, oval } = await getLandmarker();
  const fo = lm.detect(o).faceLandmarks || [];
  const fr = lm.detect(r).faceLandmarks || [];
  const ow = o.naturalWidth, oh = o.naturalHeight, W = r.naturalWidth, H = r.naturalHeight;
  if (!fo.length) return { image: outSrc, faces: 0, matched: 0 };

  const out = canvas(W, H);
  const ctx = out.getContext('2d');
  ctx.drawImage(r, 0, 0);

  const used = new Set();
  let matched = 0;
  for (const f of fo) {
    const c = center(f);
    let best = -1, bestD = 0.15; // normalize mesafe eşiği
    fr.forEach((g, j) => {
      if (used.has(j)) return;
      const k = center(g), dd = Math.hypot(k[0] - c[0], k[1] - c[1]);
      if (dd < bestD) { bestD = dd; best = j; }
    });

    let T;
    if (best >= 0) {
      used.add(best); matched++;
      const g = fr[best];
      T = fitSimilarity(f.map(p => [p.x * ow, p.y * oh]), g.map(p => [p.x * W, p.y * H]));
    } else {
      T = [W / ow, 0, 0, H / oh, 0, 0]; // eşleşme yoksa aynı kadraj varsay
    }

    const poly = oval.map(i => [f[i].x * ow, f[i].y * oh]);
    const xs = poly.map(p => p[0]);
    const faceW = (Math.max(...xs) - Math.min(...xs)) * Math.hypot(T[0], T[1]);
    const feather = Math.max(2, faceW * 0.05);

    const layer = canvas(W, H), lg = layer.getContext('2d');
    lg.setTransform(...T);
    lg.drawImage(o, 0, 0);
    lg.setTransform(1, 0, 0, 1, 0, 0);
    const mask = canvas(W, H);
    drawMask(mask, T, poly, feather);
    lg.globalCompositeOperation = 'destination-in';
    lg.drawImage(mask, 0, 0);
    ctx.drawImage(layer, 0, 0);
  }
  return { image: out.toDataURL('image/png'), faces: fo.length, matched };
}
