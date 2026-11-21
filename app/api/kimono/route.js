// Sanal deneme: kişinin fotoğrafı + örnek giysi → kişi o giysiyi giymiş hali.
// OpenRouter üzerinden google/gemini-2.5-flash-image kullanır.
export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';
const IMG_RE = /^data:image\/(png|jpe?g|webp);base64,/;

const PROMPT =
  'Virtual try-on. You are given two images.\n' +
  'IMAGE 1 = a photo of a person (or people).\n' +
  'IMAGE 2 = a clothing item / outfit.\n\n' +
  'TASK: Generate an image of the person from IMAGE 1 now WEARING the outfit from IMAGE 2. ' +
  'Remove their current clothes and replace them completely with the garment from IMAGE 2. ' +
  'Copy the garment exactly: same type, cut, length, color, pattern, print, fabric texture and details. ' +
  'Fit it naturally to their body and pose, with realistic folds and shadows.\n\n' +
  'KEEP from IMAGE 1: the same face, identity, hair, skin tone, body shape, pose, camera framing, background and lighting.\n' +
  'IGNORE from IMAGE 2: any model, mannequin, face, body or background — use only the clothing.\n\n' +
  'The clothing in the output MUST be visibly different from the original clothing in IMAGE 1 and must match IMAGE 2. ' +
  'Do not return IMAGE 1 unchanged. Output one photorealistic image.';

export async function POST(req) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return Response.json({ error: 'OPENROUTER_API_KEY tanımlı değil (Vercel → Settings → Environment Variables).' }, { status: 500 });

  const pass = process.env.KIMONO_PASSWORD;
  if (pass && req.headers.get('x-kimono-password') !== pass) {
    return Response.json({ error: 'Şifre hatalı.' }, { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Geçersiz istek (fotoğraflar çok büyük olabilir).' }, { status: 400 }); }
  const person = body?.image;
  const outfit = body?.refs?.[0]?.image;
  if (typeof person !== 'string' || !IMG_RE.test(person)) return Response.json({ error: 'Kişinin fotoğrafı eksik.' }, { status: 400 });
  if (typeof outfit !== 'string' || !IMG_RE.test(outfit)) return Response.json({ error: 'Örnek giysi fotoğrafı eksik.' }, { status: 400 });

  const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
  const ar = Number(body.aspect) > 0 ? Number(body.aspect) : 0;
  const val = x => { const [w, h] = x.split(':').map(Number); return w / h; };
  const aspect = ar ? RATIOS.reduce((b, x) => (Math.abs(Math.log(val(x) / ar)) < Math.abs(Math.log(val(b) / ar)) ? x : b)) : null;

  const content = [
    { type: 'text', text: PROMPT },
    { type: 'text', text: 'IMAGE 1 (the person):' },
    { type: 'image_url', image_url: { url: person } },
    { type: 'text', text: 'IMAGE 2 (the outfit to put on the person):' },
    { type: 'image_url', image_url: { url: outfit } },
    { type: 'text', text: 'Now generate the person from IMAGE 1 wearing the outfit from IMAGE 2.' },
  ];

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://neslihan-rho.vercel.app',
      'X-Title': 'Kiyafet Giydir',
    },
    body: JSON.stringify({ model: MODEL, modalities: ['image', 'text'], messages: [{ role: 'user', content }], ...(aspect ? { image_config: { aspect_ratio: aspect } } : {}) }),
  });

  const data = await r.json().catch(() => null);
  if (!r.ok) {
    console.error('openrouter error', r.status, JSON.stringify(data)?.slice(0, 500));
    return Response.json({ error: data?.error?.message || `OpenRouter hatası (${r.status})` }, { status: 502 });
  }
  const msg = data?.choices?.[0]?.message;
  const images = msg?.images || [];
  console.log('model', data?.model, 'images', images.length, 'text', typeof msg?.content === 'string' ? msg.content.slice(0, 300) : '');
  const out = images[images.length - 1]?.image_url?.url;
  if (!out) {
    return Response.json({ error: 'Model görsel döndürmedi. ' + (typeof msg?.content === 'string' ? msg.content.slice(0, 300) : '') }, { status: 502 });
  }
  return Response.json({ image: out });
}
