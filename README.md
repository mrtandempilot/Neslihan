# Kimono Editor

Fotoğraf yükle → yüz, kimlik ve poz aynı kalır, sadece kıyafet geleneksel Japon kimonosu (obi ile) olur.
Model: `google/gemini-2.5-flash-image` (OpenRouter).

## Vercel ortam değişkenleri
- `OPENROUTER_API_KEY` — zorunlu
- `KIMONO_PASSWORD` — isteğe bağlı; ayarlanırsa sayfada bu şifre istenir
- `OPENROUTER_IMAGE_MODEL` — isteğe bağlı, varsayılan `google/gemini-2.5-flash-image`

## Yerel
```
npm install
OPENROUTER_API_KEY=... npm run dev
```
