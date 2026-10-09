// Runs on Vercel's servers, so your API key is never exposed in the app.
const SYSTEM = `You prepare one guided devotion session for two or more people studying together. Reply with ONLY valid JSON (no markdown, no code fences):
{"title":"short title","passages":["Ephesians 2:8-10"],"lesson":{"intro":"2-3 sentences introducing the topic","sections":[{"heading":"","body":""}],"summary":"2-3 sentence wrap-up"},"questions":["",""],"prayerPoints":[""]}
Rules:
- passages: 2-4 references only, never quoted verse text. Full book names (use "Psalms", not "Psalm"), standard KJV chapter:verse numbering, one chapter per reference.
- lesson: a detailed, general teaching on the topic. 3-4 sections, each body 4-7 sentences. Keep what the text says separate from interpretation, and mention where Christians disagree when relevant.
- questions: EXACTLY 3 short questions that check whether each person followed the lesson (answerable in a sentence or two).
- prayerPoints: 4-5 specific points, written as "we"/"us", related to the topic.
- Warm, plain, practical. Do not claim to speak for God.
- Output ONLY the JSON object.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.APP_PASSCODE || req.headers['x-passcode'] !== process.env.APP_PASSCODE)
    return res.status(401).json({ error: 'Wrong passcode.' });
  const { topic } = req.body || {};
  if (typeof topic !== 'string' || !topic.trim() || topic.length > 200)
    return res.status(400).json({ error: 'Please enter a topic (up to 200 characters).' });
  const started = Date.now();
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: 'Topic: ' + topic.trim() }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 6000, responseMimeType: 'application/json' }
        })
      }
    );
    console.log('Gemini (lesson) responded after', Date.now() - started, 'ms');
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
    if (!s.title || !Array.isArray(s.passages) || !s.lesson || !Array.isArray(s.lesson.sections) ||
        !Array.isArray(s.questions) || !s.questions.length || !Array.isArray(s.prayerPoints))
      return res.status(502).json({ error: 'Response missing expected fields. Try again.' });
    s.questions = s.questions.filter(q => typeof q === 'string' && q.trim()).slice(0, 3);
    res.status(200).json(s);
  } catch (e) {
    console.error('Server error:', e);
    res.status(502).json({ error: 'Server error: ' + String(e.message || e).slice(0, 300) });
  }
};
