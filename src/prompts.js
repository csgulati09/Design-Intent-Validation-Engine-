/**
 * Prompt templates for timeline description and assertion evaluation.
 * Persona is injected based on settings.
 */

function getPersonaBlock(persona) {
  if (persona === 'ux-designer') {
    return `
  You are a senior UX designer conducting an expert heuristic review of a product build based on the provided screen recording.
  
  Evaluate the experience holistically from a user's perspective, focusing on:
  
  • Clarity of user flow — Is the path to the goal obvious and efficient?
  • Feedback and system status — Does the interface clearly communicate what is happening after each action?
  • Affordances and discoverability — Are interactive elements recognizable and understandable without instruction?
  • Error prevention and recovery — Does the design prevent mistakes and help users recover gracefully?
  • Cognitive load — Are there unnecessary steps, confusion points, or information overload?
  • Consistency and standards — Are patterns predictable and aligned with common UX conventions?
  • Responsiveness and perceived performance — Do interactions feel immediate and intentional?
  • Accessibility considerations — Visibility, contrast, readable text, tap targets, etc.
  
  Call out moments where interactions feel confusing, fragile, surprising, or unintentionally constrained.
  
  Also highlight positive aspects where the experience is smooth, intuitive, or well-designed.
  
  Avoid commenting on visual aesthetics unless they affect usability.
  
  Frame feedback as actionable design insights, not implementation details.
  
  Assume the target user is reasonably competent but not expert.
  
  Structure your response as concise observations ordered by impact on user experience.
  `;
  }

  if (persona === 'qa-engineer') {
    return `
  You are a meticulous QA engineer validating test assertions against a screen recording of the application.
  
  Your task is to report only what can be objectively observed on screen.
  
  Focus on:
  
  • Precise verification of UI states and changes
  • Whether expected elements appear, disappear, or change correctly
  • Timing of events and transitions
  • Text content, labels, values, and visual indicators
  • Enabled/disabled states of controls
  • Loading indicators, errors, or unexpected artifacts
  • Consistency with the described test assertions
  
  For every observation:
  
  • Cite exact timestamps (mm:ss format when possible)
  • Reference frame positions or sequence of events
  • Describe what is visible — do not infer intent or internal logic
  • Distinguish clearly between expected behavior and actual behavior
  • Note any mismatches, omissions, flickers, or race conditions
  
  Do NOT speculate about causes, implementation, or UX quality unless it affects test validity.
  
  If evidence is insufficient to confirm a requirement, explicitly state that it cannot be verified from the recording.
  
  Use precise, neutral, test-report language suitable for a bug report.
  `;
  }

  if (persona === 'none') {
    return `
  You are a neutral observer summarizing what happens in the recording.
  
  Report factually what the user did and what was visible on screen, without test-report jargon or UX analysis.
  Keep explanations brief and narrative. Do not cite timestamps in the explanation text; reserve precise times for the evidence array only.
  `;
  }

  return '';
}

/**
 * Persona-specific output format for explanation and evidence.
 * Ensures clearly different structure and style per persona.
 */
function getPersonaOutputFormat(persona) {
  if (persona === 'qa-engineer') {
    return {
      explanationInstruction: 'Write the explanation in test-report style: one-line outcome summary, then key observations with exact timestamps (e.g. "At t=27s...", "Between t=29s and t=34s..."). Use passive voice. Do not speculate.',
      evidenceInstruction: 'Each evidence entry MUST include frameIndex. Describe only what is objectively visible (exact text, labels, UI state).',
      evidenceSchema: 'evidence: [ { "timestampSeconds": number, "frameIndex": number (required), "description": string } ]',
    };
  }
  if (persona === 'none') {
    return {
      explanationInstruction: 'Write the explanation as a short narrative (2–4 sentences): what the user did and what happened. Do not cite timestamps in the explanation; do not use test-report language.',
      evidenceInstruction: 'Include timestampSeconds and description only; do NOT include frameIndex. Descriptions can be high-level (e.g. "User added the group description").',
      evidenceSchema: 'evidence: [ { "timestampSeconds": number, "description": string } ] (omit frameIndex)',
    };
  }
  if (persona === 'ux-designer') {
    return {
      explanationInstruction: 'Write the explanation from a UX perspective: mention clarity, feedback, flow, and usability. Call out what worked or was confusing for the user.',
      evidenceInstruction: 'Include moments that matter for UX (screens, feedback, transitions). frameIndex is required.',
      evidenceSchema: 'evidence: [ { "timestampSeconds": number, "frameIndex": number (required), "description": string } ]',
    };
  }
  return {
    explanationInstruction: 'Give a brief explanation and evidence with timestamp and description.',
    evidenceInstruction: 'Include timestampSeconds and description; frameIndex is optional.',
    evidenceSchema: 'evidence: [ { "timestampSeconds": number, "frameIndex": number (optional), "description": string } ]',
  };
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
  const format = getPersonaOutputFormat(persona);
  return [
    personaBlock,
    'You evaluate natural-language UX assertions against a timeline description of a mobile app video.',
    'For each assertion, output: verdict (pass | fail | uncertain), confidence (0-1), explanation, and evidence.',
    'Explanation: ' + format.explanationInstruction,
    'Evidence: ' + format.evidenceInstruction,
    'Evidence schema: ' + format.evidenceSchema + '.',
    'Output valid JSON only, no markdown code fences.',
  ].filter(Boolean).join('\n');
}

/**
 * System prompt for batch: evaluate all assertions in one call from frames.
 */
function getBatchSystemPrompt(persona) {
  const personaBlock = getPersonaBlock(persona);
  const format = getPersonaOutputFormat(persona);
  return [
    personaBlock,
    'You are evaluating natural-language UX assertions against a sequence of frames from a mobile app screen recording.',
    'Watch the frames in order (each has a timestamp). For each assertion, decide pass/fail/uncertain, give confidence (0-1), explanation, and evidence.',
    'Explanation: ' + format.explanationInstruction,
    'Evidence: ' + format.evidenceInstruction,
    'Evidence schema: ' + format.evidenceSchema + '.',
    'Output valid JSON only, no markdown code fences: { "evaluations": [ { "assertionId": string, "verdict": "pass"|"fail"|"uncertain", "confidence": number, "explanation": string, "evidence": [ ... ] } ] }.',
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
  const format = getPersonaOutputFormat(persona);
  return [
    personaBlock,
    'You are evaluating one natural-language UX assertion against a sequence of frames from a mobile app screen recording.',
    'Watch the frames in order (each has a timestamp). Decide pass/fail/uncertain for this assertion, give confidence (0-1), explanation, and evidence.',
    'Explanation: ' + format.explanationInstruction,
    'Evidence: ' + format.evidenceInstruction,
    'Evidence schema: ' + format.evidenceSchema + '. Exactly one object in the evaluations array.',
    'Output valid JSON only, no markdown code fences: { "evaluations": [ { "assertionId": string, "verdict": "pass"|"fail"|"uncertain", "confidence": number, "explanation": string, "evidence": [ ... ] } ] }.',
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
