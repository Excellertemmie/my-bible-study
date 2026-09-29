// Runs on Vercel's servers, so your API key is never exposed in the app.
const SYSTEM = `You write multiple-choice Bible quiz questions. Reply with ONLY valid JSON (no markdown, no code fences):
{"title":"","questions":[{"prompt":"","options":["option A","option B","option C","option D"],"correctIndex":0,"explanation":"why this is correct, 1-2 sentences","reference":"Book chap:verse"}]}
Rules:
- Each question has exactly 4 options, plausible but only one correct.
- correctIndex is 0, 1, 2 or 3, matching the position of the correct option in the options array.
- reference is the passage the question is drawn from, full book name, standard KJV chapter:verse numbering.
- Do not quote long verse text in options; keep options short (a few words to one short phrase).
- Vary question style: some factual (who/what/where), some about meaning or sequence of events.
- Match the requested difficulty: easy = well-known, central facts. medium = requires knowing the passage reasonably well. hard = specific details, less commonly remembered.
- Output ONLY the JSON object with exactly the requested number of questions.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.APP_PASSCODE || req.headers['x-passcode'] !== process.env.APP_PASSCODE)
    return res.status(401).json({ error: 'Wrong passcode.' });
  const { topic, count, difficulty } = req.body || {};
  if (typeof topic !== 'string' || !topic.trim() || topic.length > 200)
    return res.status(400).json({ error: 'Please enter a topic (up to 200 characters).' });
  const n = [5, 10, 15].includes(Number(count)) ? Number(count) : 5;
  const diff = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';

  const started = Date.now();
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: `Topic: ${topic.trim()}\nNumber of questions: ${n}\nDifficulty: ${diff}` }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 4000, responseMimeType: 'application/json' }
        })
      }
    );
    console.log('Gemini (quiz) responded after', Date.now() - started, 'ms');
    const data = await r.json();
    if (!r.ok) {
      console.error('Gemini error:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gemini error: ' + (data.error?.message || JSON.stringify(data)).slice(0, 300) });
    }
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
    if (!text) return res.status(502).json({ error: 'Gemini returned no text. Reason: ' + (data.candidates?.[0]?.finishReason || 'unknown') });
    let s;
    try { s = JSON.parse(text); }
    catch { return res.status(502).json({ error: 'The response was cut off before finishing. Try again, or pick fewer questions.' }); }
    if (!s.title || !Array.isArray(s.questions) || !s.questions.length)
      return res.status(502).json({ error: 'Response missing expected fields.' });
    s.questions = s.questions.filter(q => q && Array.isArray(q.options) && q.options.length === 4 &&
      Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex <= 3 && q.prompt);
    if (!s.questions.length) return res.status(502).json({ error: 'Could not build valid questions. Try again.' });
    res.status(200).json(s);
  } catch (e) {
    console.error('Server error:', e);
    res.status(502).json({ error: 'Server error: ' + String(e.message || e).slice(0, 300) });
  }
};
