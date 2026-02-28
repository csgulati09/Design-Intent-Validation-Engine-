/**
 * Prompt templates for timeline description and assertion evaluation.
 * Persona is injected based on settings.
 */

function getPersonaBlock(persona) {
  if (persona === 'ux-designer') {
    return 'You are a senior UX designer reviewing a build. Focus on user flow, clarity of feedback, and whether interactions feel intentional and forgiving.';
  }
  if (persona === 'qa-engineer') {
    return 'You are a QA engineer evaluating test assertions against a screen recording. Be precise about what is visible and when; cite timestamps and frame indices.';
  }
  return '';
}

/**
 * Line describing which moments to include in the timeline, by persona.
 */
function getTimelineMomentsLine(persona) {
  if (persona === 'ux-designer') {
    return 'Order by timestamp. Include only moments that matter for UX (screens, taps, transitions, CTAs, selections, feedback).';
  }
  if (persona === 'qa-engineer') {
    return 'Order by timestamp. Include only moments relevant to test verification (screens, taps, state changes, CTAs, selections, feedback, visible UI state).';
  }
  return 'Include only moments that matter generally (screens, taps, transitions, CTAs, selections, feedback).';
}

/**
 * System prompt for the first pass: describe what happens in the video.
 */
function getTimelineSystemPrompt(persona) {
  const personaBlock = getPersonaBlock(persona);
  const momentsLine = getTimelineMomentsLine(persona);
  return [
    personaBlock,
    'You are analyzing a sequence of frames from a mobile app screen recording.',
    'For each relevant moment (or grouped moments), provide a short description and the approximate timestamp in seconds.',
    'Output a structured timeline as JSON: { "timeline": [ { "timestampSeconds": number, "description": string } ] }.',
    momentsLine,
  ].filter(Boolean).join('\n');
}

/**
 * User message for timeline: we will append frame images and optionally a short instruction.
 */
function getTimelineUserPrompt() {
  const lines = [
    'Below are frames from the video with their timestamps (in seconds).',
    'Frames are in order. Format for each: "Frame N (t=Xs)" then the image.',
    '',
    'Describe what happens in the video as a timeline. Output valid JSON only:',
    '{ "timeline": [ { "timestampSeconds": number, "description": string } ] }',
  ];
  return lines.join('\n');
}

/**
 * System prompt for the second pass: evaluate assertions against the timeline.
 */
function getEvaluationSystemPrompt(persona) {
  const personaBlock = getPersonaBlock(persona);
  return [
    personaBlock,
    'You evaluate natural-language UX assertions against a timeline description of a mobile app video.',
    'For each assertion, output: verdict (pass | fail | uncertain), confidence (0-1), explanation, and evidence (array of { timestampSeconds, frameIndex?, description }).',
    'Output valid JSON only, no markdown code fences.',
  ].filter(Boolean).join('\n');
}

/**
 * System prompt for batch: evaluate all assertions in one call from frames.
 */
function getBatchSystemPrompt(persona) {
  const personaBlock = getPersonaBlock(persona);
  return [
    personaBlock,
    'You are evaluating natural-language UX assertions against a sequence of frames from a mobile app screen recording.',
    'Watch the frames in order (each has a timestamp). For each assertion, decide pass/fail/uncertain, give confidence (0-1), a brief explanation, and evidence (timestamp and description of the relevant moment).',
    'Output valid JSON only, no markdown code fences: { "evaluations": [ { "assertionId": string, "verdict": "pass"|"fail"|"uncertain", "confidence": number, "explanation": string, "evidence": [ { "timestampSeconds": number, "frameIndex": number (optional), "description": string } ] } ] }.',
  ].filter(Boolean).join('\n');
}

/**
 * User prompt intro for batch: frames and assertions list are appended by the agent.
 */
function getBatchUserPromptIntro() {
  return [
    'Below are frames from the video (in order, with timestamps in seconds). After the frames you will see the list of assertions to evaluate.',
    '',
    'Evaluate each assertion based on what you see in the frames. Output only valid JSON with an "evaluations" array (one object per assertion with assertionId, verdict, confidence, explanation, evidence).',
  ].join('\n');
}

/**
 * System prompt for single (per-assertion): evaluate one assertion against the full video.
 */
function getSingleAssertionSystemPrompt(persona) {
  const personaBlock = getPersonaBlock(persona);
  return [
    personaBlock,
    'You are evaluating one natural-language UX assertion against a sequence of frames from a mobile app screen recording.',
    'Watch the frames in order (each has a timestamp). Decide pass/fail/uncertain for this assertion, give confidence (0-1), a brief explanation, and evidence (timestamp and description of the relevant moment).',
    'Output valid JSON only, no markdown code fences: { "evaluations": [ { "assertionId": string, "verdict": "pass"|"fail"|"uncertain", "confidence": number, "explanation": string, "evidence": [ { "timestampSeconds": number, "frameIndex": number (optional), "description": string } ] } ] }. Exactly one object in the evaluations array.',
  ].filter(Boolean).join('\n');
}

/**
 * User prompt intro for single (per-assertion): frames and the one assertion are appended by the agent.
 */
function getSingleAssertionUserPromptIntro() {
  return [
    'Below are frames from the video (in order, with timestamps in seconds). After the frames you will see the single assertion to evaluate.',
    '',
    'Evaluate this assertion based on what you see in the frames. Output only valid JSON with an "evaluations" array containing exactly one object (assertionId, verdict, confidence, explanation, evidence).',
  ].join('\n');
}

/**
 * Build user message for evaluation: timeline + assertions list.
 */
function getEvaluationUserPrompt(timelineJson, assertions) {
  const assertionsList = assertions
    .map((a) => `- [${a.id}] ${a.text} (testStepId: ${a.testStepId || 'unknown'})`)
    .join('\n');

  return [
    '## Timeline from the video',
    '```json',
    typeof timelineJson === 'string' ? timelineJson : JSON.stringify(timelineJson, null, 2),
    '```',
    '',
    '## Assertions to evaluate',
    assertionsList,
    '',
    'For each assertion, produce a single JSON object with this shape (one entry per assertion):',
    '{ "evaluations": [ { "assertionId": string, "verdict": "pass"|"fail"|"uncertain", "confidence": number (0-1), "explanation": string, "evidence": [ { "timestampSeconds": number, "frameIndex": number (optional), "description": string } ] } ] }',
    'Output only valid JSON, no extra text.',
  ].join('\n');
}

module.exports = {
  getPersonaBlock,
  getTimelineSystemPrompt,
  getTimelineUserPrompt,
  getEvaluationSystemPrompt,
  getEvaluationUserPrompt,
  getBatchSystemPrompt,
  getBatchUserPromptIntro,
  getSingleAssertionSystemPrompt,
  getSingleAssertionUserPromptIntro,
};
