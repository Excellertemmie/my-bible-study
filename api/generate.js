// Runs on Vercel's servers, so your API key is never exposed in the app.
const SYSTEM = `You help one person study the Bible. Reply with ONLY valid JSON (no markdown, no commentary, no code fences) in exactly this shape:
{"title":"","theme":"one sentence","passages":["Ephesians 2:8-10"],"context":"short background: author, audience, setting","points":[{"heading":"","explanation":""}],"questions":{"observation":[""],"interpretation":[""],"application":[""]},"prayer":"a short prayer based on the theme, in first person"}
Rules:
- passages are references only. Never quote verse text. Use full book names (1 Corinthians, Psalms, Song of Solomon), standard KJV chapter:verse numbering, and one chapter per reference like "John 3:16-17".
- Keep what the text says separate from interpretation. Use wording like "this suggests" for interpretation, and mention where Christians disagree when relevant.
- Do not claim to speak for God. Be warm, plain and practical.
- Size by depth: quick = 2-3 passages, 2 points, 1 question per type. standard = 3-4 passages, 3 points, 2 questions per type. deep = 4-5 passages, 4 points, 3 questions per type.
- Output ONLY the JSON object. Nothing before or after it.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.APP_PASSCODE || req.headers['x-passcode'] !== process.env.APP_PASSCODE)
    return res.status(401).json({ error: 'Wrong passcode.' });
  const { topic, depth } = req.body || {};
  if (typeof topic !== 'string' || !topic.trim() || topic.length > 200)
    return res.status(400).json({ error: 'Please enter a topic (up to 200 characters).' });
  const d = ['quick', 'standard', 'deep'].includes(depth) ? depth : 'standard';
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: `Topic: ${topic.trim()}\nDepth: ${d}` }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2500, responseMimeType: 'application/json' }
        })
      }
    );
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'The AI service returned an error. Check your API key and quota.' });
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
    const s = JSON.parse(text);
    if (!s.title || !Array.isArray(s.passages) || !s.questions) throw new Error('bad shape');
    res.status(200).json(s);
  } catch (e) {
    res.status(502).json({ error: 'Could not build the study. Please try again.' });
  }
};
