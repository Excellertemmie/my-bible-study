// Runs on Vercel's servers, so your API key is never exposed in the app.
const SYSTEM = `You help one person understand a specific Bible passage they are reading on their own. Reply with ONLY valid JSON (no markdown, no code fences):
{"answer":"2-4 short paragraphs answering the question","references":["John 3:16"]}
Rules:
- Never quote verse text directly; describe or paraphrase briefly instead.
- Clearly separate what the text says from interpretation, using wording like "this suggests" or "many read this as".
- Note where Christians hold different views, when relevant.
- Do not claim to speak for God.
- references: 0 to 4 related passages for further reading, in "Book chapter:verse" format using full book names (1 Corinthians, Psalms, Song of Solomon) and standard KJV numbering.
- Keep the answer focused and practical, under 200 words total.
- Output ONLY the JSON object. Nothing before or after it.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.APP_PASSCODE || req.headers['x-passcode'] !== process.env.APP_PASSCODE)
    return res.status(401).json({ error: 'Wrong passcode.' });
  const { passage, question } = req.body || {};
  if (typeof passage !== 'string' || !passage.trim() || typeof question !== 'string' || !question.trim() || question.length > 300)
    return res.status(400).json({ error: 'Please enter a question (up to 300 characters).' });

  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: `Passage: ${passage.trim()}\nQuestion: ${question.trim()}` }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 1200, responseMimeType: 'application/json' }
        })
      }
    );
    const data = await r.json();
    if (!r.ok) {
      console.error('Gemini error:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gemini error: ' + (data.error?.message || JSON.stringify(data)).slice(0, 300) });
    }
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
    if (!text) {
      console.error('Empty response:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gemini returned no text. Reason: ' + (data.candidates?.[0]?.finishReason || 'unknown') });
    }
    let s;
    try { s = JSON.parse(text); }
    catch { return res.status(502).json({ error: 'The response was cut off before finishing. Try again.' }); }
    if (!s.answer) return res.status(502).json({ error: 'Response missing expected fields.' });
    res.status(200).json(s);
  } catch (e) {
    console.error('Server error:', e);
    res.status(502).json({ error: 'Server error: ' + String(e.message || e).slice(0, 300) });
  }
};
