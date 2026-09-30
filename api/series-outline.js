// Runs on Vercel's servers, so your API key is never exposed in the app.
const SYSTEM = `You plan a multi-session Bible study series. Given a general topic and how many sessions are wanted, produce that many distinct session topics that each explore a different angle of the overall topic, in a sensible teaching order (foundational ideas first, then application). Reply with ONLY valid JSON (no markdown, no code fences):
{"seriesName":"short series name, usually close to the given topic","weeks":[{"label":"short session focus, a few words","theme":"one sentence describing what this session covers"}]}
Rules:
- Produce EXACTLY the requested number of sessions, no more, no less.
- Each label must be meaningfully different from the others — no duplicates or near-duplicates. If the topic is broad, cover different facets; if narrow, cover different angles or stages (e.g. "part 1: foundations", "part 2: obstacles", "part 3: growth").
- Keep each label concise, suitable as a short heading a person would recognize as one session's focus.
- Output ONLY the JSON object.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.APP_PASSCODE || req.headers['x-passcode'] !== process.env.APP_PASSCODE)
    return res.status(401).json({ error: 'Wrong passcode.' });
  const { topic, count } = req.body || {};
  if (typeof topic !== 'string' || !topic.trim() || topic.length > 200)
    return res.status(400).json({ error: 'Please enter a topic (up to 200 characters).' });
  const n = Math.min(12, Math.max(1, parseInt(count) || 4));

  const started = Date.now();
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: `Topic: ${topic.trim()}\nNumber of sessions: ${n}` }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 1500, responseMimeType: 'application/json' }
        })
      }
    );
    console.log('Gemini (series-outline) responded after', Date.now() - started, 'ms');
    const data = await r.json();
    if (!r.ok) {
      console.error('Gemini error:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gemini error: ' + (data.error?.message || JSON.stringify(data)).slice(0, 300) });
    }
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
    if (!text) return res.status(502).json({ error: 'Gemini returned no text. Reason: ' + (data.candidates?.[0]?.finishReason || 'unknown') });
    let s;
    try { s = JSON.parse(text); }
    catch { return res.status(502).json({ error: 'The response was cut off before finishing. Try again, or ask for fewer sessions.' }); }
    if (!Array.isArray(s.weeks) || !s.weeks.length)
      return res.status(502).json({ error: 'Could not plan the series. Try again.' });
    s.weeks = s.weeks.filter(w => w && typeof w.label === 'string' && w.label.trim()).slice(0, n);
    if (!s.weeks.length) return res.status(502).json({ error: 'Could not plan valid sessions. Try again.' });
    if (!s.seriesName) s.seriesName = topic.trim();
    res.status(200).json(s);
  } catch (e) {
    console.error('Server error:', e);
    res.status(502).json({ error: 'Server error: ' + String(e.message || e).slice(0, 300) });
  }
};
