/**
 * Claude-based agent: two-pass flow (timeline description, then assertion evaluation).
 * Persona is applied via prompts; supports ux-designer, qa-engineer, none.
 */

const Anthropic = require('@anthropic-ai/sdk');
const {
  getTimelineSystemPrompt,
  getTimelineUserPrompt,
  getEvaluationSystemPrompt,
  getEvaluationUserPrompt,
  getBatchSystemPrompt,
  getBatchUserPromptIntro,
  getSingleAssertionSystemPrompt,
  getSingleAssertionUserPromptIntro,
} = require('./prompts');
const { readFileAsBase64 } = require('./videoProcessor');

/** Max frames to send in one timeline request to avoid token/API limits. */
const MAX_FRAMES_PER_TIMELINE_REQUEST = 20;

/**
 * Sample frames evenly to stay under maxFrames.
 * @param {Array<{ framePath: string, timestampSeconds: number, frameIndex: number }>} frames
 * @param {number} maxFrames
 * @returns {typeof frames}
 */
function sampleFramesEvenly(frames, maxFrames) {
  if (frames.length <= maxFrames) return frames;
  const step = (frames.length - 1) / (maxFrames - 1);
  const indices = [];
  for (let i = 0; i < maxFrames; i++) {
    const idx = Math.round(i * step);
    indices.push(Math.min(idx, frames.length - 1));
  }
  return indices.map((i) => frames[i]);
}

/**
 * Build content array for timeline: text prompt + alternating text captions and image blocks.
 */
function buildTimelineContent(frames, userPrompt) {
  const content = [{ type: 'text', text: userPrompt }];

  const sampled = sampleFramesEvenly(frames, MAX_FRAMES_PER_TIMELINE_REQUEST);

  for (const frame of sampled) {
    content.push({
      type: 'text',
      text: `Frame ${frame.frameIndex} (t=${frame.timestampSeconds.toFixed(1)}s)`,
    });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: readFileAsBase64(frame.framePath),
      },
    });
  }

  return content;
}

/**
 * Parse JSON from model response (strip markdown code blocks if present).
 */
function parseJsonFromResponse(text) {
  let raw = (text || '').trim();
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) raw = match[1].trim();
  return JSON.parse(raw);
}

/**
 * First pass: get timeline description from video frames.
 * @param {object} opts
 * @param {object} opts.client - Anthropic client
 * @param {string} opts.model - Model ID
 * @param {number} opts.maxTokens
 * @param {string} opts.persona
 * @param {Array<{ framePath: string, timestampSeconds: number, frameIndex: number }>} opts.frames
 * @returns {Promise<{ timeline: Array<{ timestampSeconds: number, description: string }> }>}
 */
async function describeTimeline(opts) {
  const { client, model, maxTokens, persona, frames } = opts;
  const userPrompt = getTimelineUserPrompt();
  const content = buildTimelineContent(frames, userPrompt);

  const system = getTimelineSystemPrompt(persona);

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
  });

  const text = response.content?.find((c) => c.type === 'text')?.text || '{}';
  const parsed = parseJsonFromResponse(text);
  const timeline = Array.isArray(parsed.timeline) ? parsed.timeline : [];
  return { timeline };
}

/**
 * Second pass: evaluate assertions against the timeline (no images).
 */
async function evaluateAssertions(opts) {
  const { client, model, maxTokens, persona, timeline, assertions } = opts;
  const timelineJson = JSON.stringify({ timeline }, null, 2);
  const userPrompt = getEvaluationUserPrompt(timelineJson, assertions);
  const system = getEvaluationSystemPrompt(persona);

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content?.find((c) => c.type === 'text')?.text || '{}';
  const parsed = parseJsonFromResponse(text);
  const evaluations = Array.isArray(parsed.evaluations) ? parsed.evaluations : [];
  return { evaluations };
}

/**
 * Build content for batch: intro + frame captions/images + assertions list.
 */
function buildBatchContent(frames, assertions) {
  const intro = getBatchUserPromptIntro();
  const content = [{ type: 'text', text: intro }];

  const sampled = sampleFramesEvenly(frames, MAX_FRAMES_PER_TIMELINE_REQUEST);
  for (const frame of sampled) {
    content.push({
      type: 'text',
      text: `Frame ${frame.frameIndex} (t=${frame.timestampSeconds.toFixed(1)}s)`,
    });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: readFileAsBase64(frame.framePath),
      },
    });
  }

  const assertionsList = assertions
    .map((a) => `- [${a.id}] ${a.text} (testStepId: ${a.testStepId || 'unknown'})`)
    .join('\n');
  content.push({
    type: 'text',
    text: '\n## Assertions to evaluate\n' + assertionsList + '\n\nOutput only valid JSON with an "evaluations" array (assertionId, verdict, confidence, explanation, evidence).',
  });

  return content;
}

/**
 * Build content for single (per-assertion): intro + frames + one assertion.
 */
function buildSingleAssertionContent(frames, assertion) {
  const intro = getSingleAssertionUserPromptIntro();
  const content = [{ type: 'text', text: intro }];

  const sampled = sampleFramesEvenly(frames, MAX_FRAMES_PER_TIMELINE_REQUEST);
  for (const frame of sampled) {
    content.push({
      type: 'text',
      text: `Frame ${frame.frameIndex} (t=${frame.timestampSeconds.toFixed(1)}s)`,
    });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: readFileAsBase64(frame.framePath),
      },
    });
  }

  content.push({
    type: 'text',
    text: `\n## Assertion to evaluate\n[${assertion.id}] ${assertion.text} (testStepId: ${assertion.testStepId || 'unknown'})\n\nOutput only valid JSON with an "evaluations" array containing exactly one object (assertionId: "${assertion.id}", verdict, confidence, explanation, evidence).`,
  });

  return content;
}

/**
 * Batch: one VLM call with full video + all assertions; output evaluations only.
 */
async function runBatchPipeline(opts) {
  const { apiKey, model, maxTokens, persona, frames, assertions } = opts;
  const client = new Anthropic({ apiKey });
  const effectivePersona = persona;

  const content = buildBatchContent(frames, assertions);
  const system = getBatchSystemPrompt(effectivePersona);

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
  });

  const text = response.content?.find((c) => c.type === 'text')?.text || '{}';
  const parsed = parseJsonFromResponse(text);
  const evaluations = Array.isArray(parsed.evaluations) ? parsed.evaluations : [];

  const byId = new Map();
  for (const e of evaluations) {
    const id = e.assertionId || e.id;
    if (id) byId.set(id, e);
  }

  return {
    timeline: [],
    evaluations: byId,
  };
}

/**
 * Single: one VLM call per assertion, each with the full video (frames) + that assertion.
 */
async function runSinglePipeline(opts) {
  const { apiKey, model, maxTokens, persona, frames, assertions } = opts;
  const client = new Anthropic({ apiKey });
  const effectivePersona = persona;
  const system = getSingleAssertionSystemPrompt(effectivePersona);

  const byId = new Map();
  for (const assertion of assertions) {
    const content = buildSingleAssertionContent(frames, assertion);
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
    });

    const text = response.content?.find((c) => c.type === 'text')?.text || '{}';
    let evaluations = [];
    try {
      const parsed = parseJsonFromResponse(text);
      evaluations = Array.isArray(parsed.evaluations) ? parsed.evaluations : [];
    } catch (_) {
      // if parse fails, leave this assertion without evaluation
    }
    const e = evaluations[0];
    if (e) {
      const id = e.assertionId || e.id || assertion.id;
      byId.set(id, e);
    } else {
      byId.set(assertion.id, { assertionId: assertion.id, verdict: 'uncertain', confidence: 0, explanation: 'No evaluation returned.', evidence: [] });
    }
  }

  return {
    timeline: [],
    evaluations: byId,
  };
}

/**
 * Two-pass: describe timeline from frames, then evaluate assertions from timeline.
 */
async function runTwoPassPipeline(opts) {
  const {
    apiKey,
    model,
    maxTokens,
    persona,
    frames,
    assertions,
  } = opts;

  const client = new Anthropic({ apiKey });
  const effectivePersona = persona;

  const { timeline } = await describeTimeline({
    client,
    model,
    maxTokens,
    persona: effectivePersona,
    frames,
  });

  const { evaluations } = await evaluateAssertions({
    client,
    model,
    maxTokens,
    persona: effectivePersona,
    timeline,
    assertions,
  });

  const byId = new Map();
  for (const e of evaluations) {
    const id = e.assertionId || e.id;
    if (id) byId.set(id, e);
  }

  return {
    timeline,
    evaluations: byId,
  };
}

/**
 * Run the pipeline: branches on strategy ('single' | 'batch' | 'two-pass').
 */
async function runPipeline(opts) {
  const strategy = opts.strategy || 'two-pass';
  if (strategy === 'single') {
    return runSinglePipeline(opts);
  }
  if (strategy === 'batch') {
    return runBatchPipeline(opts);
  }
  return runTwoPassPipeline(opts);
}

module.exports = {
  describeTimeline,
  evaluateAssertions,
  runPipeline,
  runSinglePipeline,
  runBatchPipeline,
  runTwoPassPipeline,
  sampleFramesEvenly,
  MAX_FRAMES_PER_TIMELINE_REQUEST,
};
