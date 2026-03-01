/**
 * Agent tools: definitions (for Claude API) and executors.
 * Tools are invoked by the orchestrator agent; executors run the actual pipeline steps.
 */

const { describeTimeline, evaluateAssertions } = require('../claudeAgent');

/** Tool definitions for the Messages API (name, description, input_schema). */
const TOOL_DEFINITIONS = [
  {
    name: 'describe_timeline',
    description: 'Analyze the extracted video frames and produce a structured timeline of what happens in the recording. Call this first to get a timeline of key moments (screens, taps, transitions, feedback) with timestamps. Returns JSON: { "timeline": [ { "timestampSeconds": number, "description": string } ] }.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'evaluate_assertions',
    description: 'Evaluate all UX assertions against a timeline. Call this after describe_timeline. Pass the timeline you received from describe_timeline as the "timeline" parameter. Returns JSON: { "evaluations": [ { "assertionId": string, "verdict": "pass"|"fail"|"uncertain", "confidence": number, "explanation": string, "evidence": array } ] }.',
    input_schema: {
      type: 'object',
      properties: {
        timeline: {
          type: 'array',
          description: 'The timeline array from describe_timeline (each item: { timestampSeconds: number, description: string })',
          items: {
            type: 'object',
            properties: {
              timestampSeconds: { type: 'number' },
              description: { type: 'string' },
            },
            required: ['timestampSeconds', 'description'],
          },
        },
      },
      required: ['timeline'],
    },
  },
];

/**
 * Execute a single tool by name.
 * @param {object} opts
 * @param {string} opts.toolName - Tool name (describe_timeline | evaluate_assertions)
 * @param {object} opts.toolInput - Parsed input from the model
 * @param {object} opts.context - Shared context: { client, model, maxTokens, persona, frames, assertions }
 * @returns {Promise<{ content: string, isError?: boolean }>} Tool result content (JSON string) and optional error flag
 */
async function executeTool(opts) {
  const { toolName, toolInput, context } = opts;
  const { client, model, maxTokens, persona, frames, assertions } = context;

  try {
    if (toolName === 'describe_timeline') {
      const { timeline } = await describeTimeline({
        client,
        model,
        maxTokens,
        persona,
        frames,
      });
      return { content: JSON.stringify({ timeline }) };
    }

    if (toolName === 'evaluate_assertions') {
      const timeline = Array.isArray(toolInput.timeline) ? toolInput.timeline : [];
      const { evaluations } = await evaluateAssertions({
        client,
        model,
        maxTokens,
        persona,
        timeline,
        assertions,
      });
      const list = Array.from(evaluations.values());
      return { content: JSON.stringify({ evaluations: list }) };
    }

    return { content: JSON.stringify({ error: `Unknown tool: ${toolName}` }), isError: true };
  } catch (err) {
    return {
      content: JSON.stringify({ error: err.message || String(err) }),
      isError: true,
    };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
};
