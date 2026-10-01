// Runs on Vercel's servers, so your API key is never exposed in the app.
const SYSTEM = `You revise an existing Bible study for a Bible study app based on a plain-English request. You will be given the study's current content as JSON and an instruction describing the change wanted.
Reply with ONLY valid JSON (no markdown, no commentary, no code fences), in exactly this shape:
{"title":"","theme":"one sentence","passages":["Ephesians 2:8-10"],"context":"","openingActivity":"","points":[{"heading":"","explanation":""}],"questions":{"observation":[""],"interpretation":[""],"application":[""]},"closingChallenge":"","prayer":""}
Rules:
- Apply the requested change. Keep everything else from the original study the same unless the request implies a broader change (e.g. "make this for teenagers" or "turn this into a Sunday school lesson" may reasonably touch vocabulary and openingActivity too).
- passages are references only, never quoted verse text. Use full book names and standard KJV chapter:verse numbering.
- Keep what the text says separate from interpretation. Do not claim to speak for God.
- Keep "openingActivity" and "closingChallenge" as empty strings if the original study did not use them and the request doesn't call for them.
- Keep exactly one question in each of "observation", "interpretation" and "application" unless the requested change explicitly asks to add or remove questions.
- Output ONLY the JSON object for the FULL revised study. Nothing before or after it.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.APP_PASSCODE || req.headers['x-passcode'] !== process.env.APP_PASSCODE)
    return res.status(401).json({ error: 'Wrong passcode.' });
  const { study, instruction } = req.body || {};
  if (!study || typeof study !== 'object' || !study.title)
    return res.status(400).json({ error: 'Missing the current study.' });
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 200)
    return res.status(400).json({ error: 'Please describe the change (up to 200 characters).' });

  const userMsg = `Current study JSON:\n${JSON.stringify(study)}\n\nRequested change: ${instruction.trim()}`;
  const started = Date.now();
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: userMsg }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 4000, responseMimeType: 'application/json' }
        })
      }
    );
    console.log('Gemini (revise) responded after', Date.now() - started, 'ms');
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
    if (!s.title || !Array.isArray(s.passages) || !s.questions)
      return res.status(502).json({ error: 'Response missing expected fields: ' + text.slice(0, 300) });
    res.status(200).json(s);
  } catch (e) {
    console.error('Server error:', e);
    res.status(502).json({ error: 'Server error: ' + String(e.message || e).slice(0, 300) });
  }
};
