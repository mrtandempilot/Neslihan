'use client';
import { useState } from 'react';
import { restoreFaces } from '../lib/faceRestore';

// Vercel'in 4.5 MB istek sınırına takılmamak için fotoğrafları tarayıcıda küçült
function shrink(file, max, q) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => reject(new Error('Fotoğraf okunamadı.'));
    img.src = URL.createObjectURL(file);
  });
}

const card = { flex: '1 1 260px', minWidth: 0, background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 4px rgba(0,0,0,.08)', display: 'grid', gap: 10, alignContent: 'start' };
const imgS = { width: '100%', height: 'auto', borderRadius: 10, display: 'block' };

function Picker({ title, value, onPick }) {
  return (
    <label style={{ ...card, cursor: 'pointer' }}>
      <b style={{ fontSize: 18 }}>{title}</b>
      {value
        ? <img src={value} alt={title} style={imgS} />
        : <div style={{ border: '2px dashed #d1d5db', borderRadius: 10, padding: '48px 12px', textAlign: 'center', color: '#6b7280' }}>Fotoğraf seç</div>}
      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onPick} />
    </label>
  );
}

function ratioOf(src) {
  return new Promise(res => { const i = new Image(); i.onload = () => res(i.width / i.height); i.onerror = () => res(0); i.src = src; });
}

export default function Kimono() {
  const [person, setPerson] = useState(null);
  const [outfit, setOutfit] = useState(null);
  const [out, setOut] = useState(null);
  const [pass, setPass] = useState('');
  const [needPass, setNeedPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const pick = (set, max) => async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setErr(''); setOut(null);
    try { set(await shrink(f, max, 0.9)); } catch (x) { setErr(x.message); }
  };

  async function run() {
    setBusy(true); setErr(''); setOut(null);
    try {
      const r = await fetch('/api/kimono', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-kimono-password': pass },
        body: JSON.stringify({ image: person, refs: [{ image: outfit, who: 'the person' }], aspect: await ratioOf(person) }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { setNeedPass(true); throw new Error('Şifre gerekli.'); }
      if (!r.ok) throw new Error(d.error || 'Hata: ' + r.status);
      // Yüzü orijinal fotoğraftan birebir geri koy
      try { setOut((await restoreFaces(person, d.image)).image); } catch { setOut(d.image); }
    } catch (x) { setErr(x.message); }
    setBusy(false);
  }

  const ready = person && outfit && !busy;

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui, sans-serif', color: '#1f2937' }}>
      <h1 style={{ margin: '0 0 20px' }}>Kıyafet Giydir</h1>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <Picker title="1. Kişinin fotoğrafı" value={person} onPick={pick(setPerson, 1536)} />
        <Picker title="2. Örnek giysi" value={outfit} onPick={pick(setOutfit, 1024)} />
      </div>

      {needPass && (
        <input type="password" placeholder="Şifre" value={pass} onChange={e => setPass(e.target.value)}
          style={{ padding: 12, borderRadius: 10, border: '1px solid #d1d5db', font: 'inherit', marginBottom: 12, display: 'block' }} />
      )}

      <button onClick={run} disabled={!ready}
        style={{ width: '100%', padding: 16, borderRadius: 12, border: 0, fontSize: 18, fontWeight: 700, color: '#fff', background: ready ? '#b91c1c' : '#9ca3af', cursor: ready ? 'pointer' : 'default' }}>
        {busy ? 'Giydiriliyor… (20–40 sn)' : 'Giydir'}
      </button>
      {err && <p style={{ color: '#b91c1c' }}>{err}</p>}

      {out && (
        <div style={{ ...card, marginTop: 20 }}>
          <b style={{ fontSize: 18 }}>Sonuç</b>
          <img src={out} alt="Sonuç" style={imgS} />
          <a href={out} download="sonuc.png" style={{ fontWeight: 600 }}>⬇ İndir</a>
        </div>
      )}
    </main>
  );
}
