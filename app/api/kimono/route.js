// Fotoğraftaki herkesin yüzünü/kimliğini/pozunu koruyarak sadece kıyafetleri değiştirir.
// İsteğe bağlı örnek kıyafet fotoğrafları (kime giydirileceği ile) alır.
// OpenRouter üzerinden google/gemini-2.5-flash-image kullanır.
export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';
const MAX_REFS = 4;
const IMG_RE = /^data:image\/(png|jpe?g|webp);base64,/;

const DEFAULT_PROMPT =
  "Keep every person's face, identity and pose exactly the same. Only change their outfits to traditional Japanese kimonos with an obi. Keep the Kyoto background and lighting.";

// Yüzlerin değişmemesi için modele her istekte eklenen kesin kurallar
const GUARD =
  'STRICT RULES: This is an image EDIT of IMAGE 1, not a new image. Keep the same number of people. For EVERY person in IMAGE 1, ' +
  'preserve the face exactly: same facial features, face shape, eyes, nose, lips, skin tone, expression, makeup, hairstyle and hair color. ' +
  'Do not beautify, retouch, age, slim, swap or re-render any face. Do not mix up the people. Keep the same body poses, hands, camera angle, ' +
  'framing, composition, background and lighting as IMAGE 1. Change ONLY the clothing. Output a single photorealistic image with the same aspect ratio as IMAGE 1.';

export async function POST(req) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return Response.json({ error: 'OPENROUTER_API_KEY tanımlı değil (Vercel → Settings → Environment Variables).' }, { status: 500 });

  const pass = process.env.KIMONO_PASSWORD;
  if (pass && req.headers.get('x-kimono-password') !== pass) {
    return Response.json({ error: 'Şifre hatalı.' }, { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Geçersiz istek (fotoğraflar çok büyük olabilir).' }, { status: 400 }); }
  const image = body?.image;
  if (typeof image !== 'string' || !IMG_RE.test(image)) {
    return Response.json({ error: 'Fotoğraf eksik veya desteklenmeyen format.' }, { status: 400 });
  }
  const refs = (Array.isArray(body.refs) ? body.refs : [])
    .filter(r => r && typeof r.image === 'string' && IMG_RE.test(r.image))
    .slice(0, MAX_REFS)
    .map(r => ({ image: r.image, who: (typeof r.who === 'string' && r.who.trim()) ? r.who.trim().slice(0, 200) : 'everyone' }));
  const extra = (typeof body.prompt === 'string' && body.prompt.trim()) ? body.prompt.trim().slice(0, 1500) : '';

  const content = [{ type: 'text', text: 'IMAGE 1 (the photo to edit):' }, { type: 'image_url', image_url: { url: image } }];
  let instructions;
  if (refs.length) {
    refs.forEach((r, i) => {
      content.push({ type: 'text', text: `IMAGE ${i + 2} (clothing reference):` });
      content.push({ type: 'image_url', image_url: { url: r.image } });
    });
    instructions =
      `Edit IMAGE 1. IMAGES 2-${refs.length + 1} are CLOTHING REFERENCES ONLY: copy just the garments (cut, color, pattern, fabric, ` +
      `belt/obi and accessories). Completely ignore the faces, bodies, poses and backgrounds of the reference images; never put a reference face into IMAGE 1.\n` +
      refs.map((r, i) => `- Dress ${r.who} in IMAGE 1 in the outfit from IMAGE ${i + 2}.`).join('\n') +
      '\nAnyone in IMAGE 1 not mentioned above keeps their original clothing, unless the extra instructions say otherwise.' +
      (extra ? `\nExtra instructions: ${extra}` : '');
  } else {
    instructions = extra || DEFAULT_PROMPT;
  }
  content.push({ type: 'text', text: `${instructions}\n\n${GUARD}` });

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://neslihan.vercel.app',
      'X-Title': 'Kimono Editor',
    },
    body: JSON.stringify({ model: MODEL, modalities: ['image', 'text'], messages: [{ role: 'user', content }] }),
  });

  const data = await r.json().catch(() => null);
  if (!r.ok) {
    return Response.json({ error: data?.error?.message || `OpenRouter hatası (${r.status})` }, { status: 502 });
  }
  const msg = data?.choices?.[0]?.message;
  const out = msg?.images?.[0]?.image_url?.url;
  if (!out) {
    return Response.json({ error: 'Model görsel döndürmedi. ' + (typeof msg?.content === 'string' ? msg.content.slice(0, 300) : '') }, { status: 502 });
  }
  return Response.json({ image: out });
}
