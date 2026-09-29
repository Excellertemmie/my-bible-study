// Runs on Vercel's servers, so your API key is never exposed in the app.
const SYSTEM = `You help someone study a single Bible chapter in depth, one chapter at a time as part of reading through a whole book. Reply with ONLY valid JSON (no markdown, no code fences):
{"context":"2-3 sentences: where this chapter sits in the book, what happens just before/after","themes":["theme 1","theme 2"],"keyVerses":[{"ref":"Book chap:verse","note":"why it matters, one sentence"}],"questions":["question 1","question 2","question 3"]}
Rules:
- Never quote verse text; describe or paraphrase instead.
- keyVerses: 2-4 verses from THIS chapter only, ref format "Book chap:verse" using the exact book name and chapter given.
- themes: 2-4 short phrases (a few words each), not full sentences.
- questions: 3-4 mixed observation/interpretation/application questions about this specific chapter.
- Keep interpretation clearly labeled as such where relevant ("this suggests", "some read this as"), and note real disagreement among Christians where relevant.
- Do not claim to speak for God.
- Output ONLY the JSON object.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.APP_PASSCODE || req.headers['x-passcode'] !== process.env.APP_PASSCODE)
    return res.status(401).json({ error: 'Wrong passcode.' });
  const { book, chapter } = req.body || {};
  if (typeof book !== 'string' || !book.trim() || typeof chapter !== 'string' && typeof chapter !== 'number')
    return res.status(400).json({ error: 'Missing book or chapter.' });

  const started = Date.now();
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: `Book: ${book.trim()}\nChapter: ${chapter}` }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 1500, responseMimeType: 'application/json' }
        })
      }
    );
    console.log('Gemini (chapter) responded after', Date.now() - started, 'ms');
    const data = await r.json();
    if (!r.ok) {
      console.error('Gemini error:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gemini error: ' + (data.error?.message || JSON.stringify(data)).slice(0, 300) });
    }
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
    if (!text) return res.status(502).json({ error: 'Gemini returned no text. Reason: ' + (data.candidates?.[0]?.finishReason || 'unknown') });
    let s;
    try { s = JSON.parse(text); }
    catch { return res.status(502).json({ error: 'The response was cut off before finishing. Try again.' }); }
    if (!s.context || !Array.isArray(s.questions))
      return res.status(502).json({ error: 'Response missing expected fields.' });
    res.status(200).json(s);
  } catch (e) {
    console.error('Server error:', e);
    res.status(502).json({ error: 'Server error: ' + String(e.message || e).slice(0, 300) });
  }
};
