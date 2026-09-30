// Runs on Vercel's servers, so your API key is never exposed in the app.
const TYPE_GUIDE = {
  personal: 'A personal study for one person studying alone. No opening activity or closing challenge needed.',
  youth: 'A youth group study. Include a short, engaging openingActivity (icebreaker or discussion starter). Use relatable, everyday language.',
  sunday_school: 'A Sunday School lesson. Include a short openingActivity suited to the audience. Keep points concrete and teachable.',
  prayer_meeting: 'A prayer meeting guide. Keep points brief and weight the study toward prayer — fewer teaching points, more specific things to pray about woven into the points themselves.',
  sermon_outline: 'A sermon outline for a preacher. points should read like sermon sections with a clear flow (e.g. introduction, main movements, conclusion). Include a closingChallenge as a call to action for the congregation.',
  family: 'A family devotion for parents and children together. Include a short, simple openingActivity the whole family can do together. Keep language simple regardless of stated audience.',
  discipleship: 'A discipleship study for mentoring one person or a small group toward spiritual growth. Include a closingChallenge that is a concrete accountability step before the next meeting.'
};
const LEVEL_GUIDE = {
  beginner: 'Beginner: simple vocabulary, no jargon, explain any theological terms used, keep interpretation light and concrete.',
  intermediate: 'Intermediate: normal church vocabulary is fine, moderate depth of interpretation.',
  advanced: 'Advanced: can include historical/cultural context, cross-references, and more theological depth, still kept practical.'
};

const SYSTEM = `You help build Bible studies for a Bible study app. Reply with ONLY valid JSON (no markdown, no commentary, no code fences) in exactly this shape:
{"title":"","theme":"one sentence","passages":["Ephesians 2:8-10"],"context":"short background: author, audience, setting","openingActivity":"","points":[{"heading":"","explanation":""}],"questions":{"observation":[""],"interpretation":[""],"application":[""]},"closingChallenge":"","prayer":"a short prayer based on the theme, in first person"}
Rules:
- passages are references only. Never quote verse text. Use full book names (1 Corinthians, Psalms, Song of Solomon), standard KJV chapter:verse numbering, and one chapter per reference like "John 3:16-17".
- Keep what the text says separate from interpretation. Use wording like "this suggests" for interpretation, and mention where Christians disagree when relevant.
- Do not claim to speak for God. Be warm, plain and practical.
- omit "openingActivity" (empty string) unless the study type calls for one. omit "closingChallenge" (empty string) unless the study type calls for one.
- Tailor vocabulary and depth to the stated audience and level.
- Size by depth: quick = 2-3 passages, 2 points, 1 question per type. standard = 3-4 passages, 3 points, 2 questions per type. deep = 4-5 passages, 4 points, 3 questions per type.
- Output ONLY the JSON object. Nothing before or after it.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.APP_PASSCODE || req.headers['x-passcode'] !== process.env.APP_PASSCODE)
    return res.status(401).json({ error: 'Wrong passcode.' });
  const { topic, depth, studyType, audience, level, seriesName, weekIndex, weekTotal, priorWeeks } = req.body || {};
  if (typeof topic !== 'string' || !topic.trim() || topic.length > 200)
    return res.status(400).json({ error: 'Please enter a topic (up to 200 characters).' });
  const d = ['quick', 'standard', 'deep'].includes(depth) ? depth : 'standard';
  const st = TYPE_GUIDE[studyType] ? studyType : 'personal';
  const lv = LEVEL_GUIDE[level] ? level : 'intermediate';
  const aud = typeof audience === 'string' && audience.trim() ? audience.trim() : 'general';
  let userMsg = `Topic: ${topic.trim()}\nDepth (length): ${d}\nStudy type: ${st} — ${TYPE_GUIDE[st]}\nAudience: ${aud}\nLevel: ${lv} — ${LEVEL_GUIDE[lv]}`;
  if (typeof seriesName === 'string' && seriesName.trim()) {
    userMsg += `\n\nThis study is week ${weekIndex} of ${weekTotal} in a multi-week series called "${seriesName.trim()}". `;
    userMsg += `Write it so it clearly belongs to that series and this week's specific angle ("${topic.trim()}"), without repeating what earlier weeks already covered.`;
    if (Array.isArray(priorWeeks) && priorWeeks.length) {
      userMsg += `\nEarlier weeks in this series (do not reuse their passages or repeat their main points):\n`;
      priorWeeks.slice(-6).forEach(w => { userMsg += `- Week "${w.label}": "${w.title}" — ${w.theme}\n`; });
    }
  }

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
          generationConfig: { temperature: 0.7, maxOutputTokens: 4000, responseMimeType: 'application/json' }
        })
      }
    );
    console.log('Gemini responded after', Date.now() - started, 'ms');
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
    catch { return res.status(502).json({ error: 'The response was cut off before finishing. Try again, or pick a shorter depth.' }); }
    if (!s.title || !Array.isArray(s.passages) || !s.questions)
      return res.status(502).json({ error: 'Response missing expected fields: ' + text.slice(0, 300) });
    res.status(200).json(s);
  } catch (e) {
    console.error('Server error:', e);
    res.status(502).json({ error: 'Server error: ' + String(e.message || e).slice(0, 300) });
  }
};
