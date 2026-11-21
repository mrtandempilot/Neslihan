'use client';
import { useState } from 'react';
import { restoreFaces } from '../lib/faceRestore';

const DEFAULT_PROMPT =
  "Keep every person's face, identity and pose exactly the same. Only change their outfits to traditional Japanese kimonos with an obi. Keep the Kyoto background and lighting.";

// Vercel'in 4.5 MB istek sınırına takılmamak için fotoğrafları tarayıcıda küçült
function shrink(file, max, q) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // şeffaf PNG'ler için
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => reject(new Error('Fotoğraf okunamadı.'));
    img.src = URL.createObjectURL(file);
  });
}

const input = { padding: 10, borderRadius: 8, border: '1px solid #d1d5db', font: 'inherit', boxSizing: 'border-box' };
const card = { background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 4px rgba(0,0,0,.08)' };
const imgS = { width: '100%', height: 'auto', borderRadius: 8, display: 'block' };

export default function Kimono() {
  const [src, setSrc] = useState(null);
  const [refs, setRefs] = useState([]); // [{ image, who }]
  const [out, setOut] = useState(null);
  const [raw, setRaw] = useState(null);
  const [keepFace, setKeepFace] = useState(true);
  const [status, setStatus] = useState('');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function pickMain(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(''); setOut(null);
    try { setSrc(await shrink(f, 1536, 0.9)); } catch (x) { setErr(x.message); }
  }

  async function addRefs(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    setErr('');
    try {
      const imgs = await Promise.all(files.map(f => shrink(f, 1024, 0.85)));
      setRefs(r => [...r, ...imgs.map(image => ({ image, who: '' }))].slice(0, 4));
    } catch (x) { setErr(x.message); }
  }

  const setWho = (i, who) => setRefs(r => r.map((x, j) => (j === i ? { ...x, who } : x)));
  const delRef = i => setRefs(r => r.filter((_, j) => j !== i));

  async function run() {
    setBusy(true); setErr(''); setOut(null); setRaw(null); setStatus('Kıyafet oluşturuluyor… (10–40 sn)');
    try {
      const r = await fetch('/api/kimono', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-kimono-password': pass },
        body: JSON.stringify({ image: src, refs, prompt: refs.length && prompt === DEFAULT_PROMPT ? '' : prompt }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || (r.status === 413 ? 'Fotoğraflar çok büyük, daha az örnek dene.' : 'Hata: ' + r.status));
      setRaw(d.image);
      if (keepFace) {
        setStatus('Orijinal yüzler geri yerleştiriliyor…');
        try {
          const f = await restoreFaces(src, d.image);
          setOut(f.image);
          setStatus(f.faces ? `${f.faces} yüz orijinal fotoğraftan birebir geri yerleştirildi.` : 'Orijinal fotoğrafta yüz bulunamadı; AI sonucu gösteriliyor.');
        } catch (x) {
          setOut(d.image);
          setStatus('Yüz geri yerleştirme başarısız oldu: ' + x.message);
        }
      } else {
        setOut(d.image); setStatus('');
      }
    } catch (x) { setErr(x.message); setStatus(''); }
    setBusy(false);
  }

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui, sans-serif', color: '#1f2937' }}>
      <h1 style={{ margin: '0 0 4px' }}>👘 Kimono Editor</h1>
      <p style={{ margin: '0 0 20px', color: '#6b7280' }}>
        Fotoğraf yükle (bir veya birden fazla kişi). İstersen örnek elbise fotoğrafı ekle ve kime giydirileceğini yaz.
        Yüzler, kimlik ve poz aynı kalır; sadece kıyafet değişir.
      </p>

      <div style={{ display: 'grid', gap: 14, marginBottom: 16 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <b>1. Fotoğraf</b>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pickMain} />
        </label>

        <div style={{ display: 'grid', gap: 6 }}>
          <b>2. Örnek elbiseler (isteğe bağlı, en fazla 4)</b>
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={addRefs} disabled={refs.length >= 4} />
          {refs.length > 0 && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {refs.map((r, i) => (
                <div key={i} style={{ ...card, width: 180, display: 'grid', gap: 6 }}>
                  <img src={r.image} alt={'Örnek ' + (i + 1)} style={{ ...imgS, maxHeight: 180, objectFit: 'contain' }} />
                  <input value={r.who} onChange={e => setWho(i, e.target.value)} placeholder="Kime? ör. the woman on the left"
                    style={{ ...input, width: '100%', padding: 8 }} />
                  <button onClick={() => delRef(i)} style={{ border: 0, background: 'none', color: '#b91c1c', cursor: 'pointer', justifySelf: 'start', padding: 0 }}>Kaldır</button>
                </div>
              ))}
            </div>
          )}
          {refs.length > 0 && <small style={{ color: '#6b7280' }}>
            "Kime?" alanına İngilizce yazmak daha iyi sonuç verir: <i>the woman on the left</i>, <i>the man on the right</i>, <i>both people</i>. Boş bırakırsan herkese giydirilir.
          </small>}
        </div>

        <label style={{ display: 'grid', gap: 6 }}>
          <b>3. Talimat</b>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} style={{ ...input, width: '100%' }} />
          {refs.length > 0 && <small style={{ color: '#6b7280' }}>Örnek elbise eklendiğinde bu alan ek talimat olarak kullanılır (varsayılan metin gönderilmez).</small>}
        </label>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={keepFace} onChange={e => setKeepFace(e.target.checked)} />
          <span><b>Yüzleri sıfır değişiklikle koru</b> (orijinal yüz pikselleri sonuca geri yapıştırılır)</span>
        </label>

        <input type="password" placeholder="Şifre (ayarlıysa)" value={pass} onChange={e => setPass(e.target.value)} style={{ ...input, maxWidth: 280 }} />
        <button onClick={run} disabled={!src || busy}
          style={{ padding: '12px 20px', borderRadius: 8, border: 0, background: busy || !src ? '#9ca3af' : '#b91c1c', color: '#fff', fontWeight: 600, cursor: src && !busy ? 'pointer' : 'default', justifySelf: 'start' }}>
          {busy ? 'Çalışıyor…' : 'Kıyafeti değiştir'}
        </button>
        {status && <div style={{ color: '#374151' }}>{status}</div>}
        {err && <div style={{ color: '#b91c1c' }}>{err}</div>}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {src && <div style={{ ...card, flex: '1 1 300px', minWidth: 0 }}><b>Orijinal</b><img src={src} alt="Orijinal" style={imgS} /></div>}
        {out && <div style={{ ...card, flex: '1 1 300px', minWidth: 0 }}><b>Sonuç</b><img src={out} alt="Sonuç" style={imgS} />
          <a href={out} download="kimono.png" style={{ display: 'inline-block', marginTop: 8 }}>⬇ İndir</a></div>}
        {raw && raw !== out && <div style={{ ...card, flex: '1 1 300px', minWidth: 0 }}><b>Ham AI sonucu</b> <small style={{ color: '#6b7280' }}>(karşılaştırma için)</small><img src={raw} alt="Ham AI" style={imgS} /></div>}
      </div>
    </main>
  );
}
