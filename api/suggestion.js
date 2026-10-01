// Runs on Vercel's servers, so your API key is never exposed in the app.
const SYSTEM = `You suggest one Bible study topic for someone to explore this week, picked from a broad, evergreen range (faith, prayer, grace, identity, relationships, wisdom, perseverance, gratitude, service, hope, and similar). Vary it — don't always pick the same topic. Reply with ONLY valid JSON (no markdown, no code fences):
{"topic":"short topic name, a few words","theme":"one sentence describing the focus","passages":["Ephesians 2:8-10"],"prayer":"a short prayer based on the theme, in first person"}
Rules:
- passages: 2-3 references only, never quoted verse text. Use full book names and standard KJV chapter:verse numbering.
- Keep it warm, plain and practical, suitable for a general audience.
- Do not claim to speak for God.
- Output ONLY the JSON object.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.APP_PASSCODE || req.headers['x-passcode'] !== process.env.APP_PASSCODE)
    return res.status(401).json({ error: 'Wrong passcode.' });

  const started = Date.now();
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: 'Suggest this week\'s topic. The current date is ' + new Date().toDateString() + ', use it only to keep suggestions varied over time, not as a theme itself.' }] }],
          generationConfig: { temperature: 1, maxOutputTokens: 1000, responseMimeType: 'application/json' }
        })
      }
    );
    console.log('Gemini (suggestion) responded after', Date.now() - started, 'ms');
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
    if (!s.topic || !Array.isArray(s.passages))
      return res.status(502).json({ error: 'Response missing expected fields.' });
    res.status(200).json(s);
  } catch (e) {
    console.error('Server error:', e);
    res.status(502).json({ error: 'Server error: ' + String(e.message || e).slice(0, 300) });
  }
};
