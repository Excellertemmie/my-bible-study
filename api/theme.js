// Runs on Vercel's servers, so your API key is never exposed in the app.
const SYSTEM = `You plan a multi-session Bible devotion series for a group. Given a theme and a number of sessions, reply with ONLY valid JSON (no markdown, no code fences):
{"theme":"the theme, tidied","topics":[{"title":"short topic title","focus":"one sentence on what this session covers"}]}
Rules:
- Return EXACTLY the requested number of topics, in a sensible order that builds from one session to the next.
- Each title is a few words, distinct from the others, and suitable as a standalone study topic.
- Warm, plain and practical. Do not claim to speak for God.
- Output ONLY the JSON object.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.APP_PASSCODE || req.headers['x-passcode'] !== process.env.APP_PASSCODE)
    return res.status(401).json({ error: 'Wrong passcode.' });
  const { theme, count } = req.body || {};
  if (typeof theme !== 'string' || !theme.trim() || theme.length > 200)
    return res.status(400).json({ error: 'Please enter a theme (up to 200 characters).' });
  const n = Math.min(10, Math.max(2, parseInt(count, 10) || 4));
  const started = Date.now();
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: `Theme: ${theme.trim()}\nNumber of sessions: ${n}` }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 2000, responseMimeType: 'application/json' }
        })
      }
    );
    console.log('Gemini (theme) responded after', Date.now() - started, 'ms');
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
    if (!Array.isArray(s.topics)) return res.status(502).json({ error: 'Response missing expected fields. Try again.' });
    s.topics = s.topics.filter(t => t && typeof t.title === 'string' && t.title.trim()).slice(0, n);
    if (!s.topics.length) return res.status(502).json({ error: 'Could not build topics. Try again.' });
    res.status(200).json(s);
  } catch (e) {
    console.error('Server error:', e);
    res.status(502).json({ error: 'Server error: ' + String(e.message || e).slice(0, 300) });
  }
};
