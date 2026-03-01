/**
 * Orchestrator agent: runs the tool-use loop and extracts timeline + evaluations from tool results.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getOrchestratorSystemPrompt, getOrchestratorUserPrompt } = require('./prompts');
const { TOOL_DEFINITIONS, executeTool } = require('./tools');

const MAX_AGENT_TURNS = 10;

/**
 * Run the agentic pipeline: orchestrator uses tools describe_timeline and evaluate_assertions.
 * Returns { timeline, evaluations } where evaluations is a Map<assertionId, evaluation>.
 *
 * @param {object} opts
 * @param {string} opts.apiKey - Anthropic API key
 * @param {string} opts.model - Model ID
 * @param {number} opts.maxTokens - Max tokens per message
 * @param {string} opts.persona - ux-designer | qa-engineer | none
 * @param {Array<{ framePath, timestampSeconds, frameIndex }>} opts.frames - Extracted frames
 * @param {Array<{ id, text, testStepId?, testStepDescription? }>} opts.assertions - Assertions to validate
 * @returns {Promise<{ timeline: Array, evaluations: Map<string, object> }>}
 */
async function runAgenticPipeline(opts) {
  const { apiKey, model, maxTokens, persona, frames, assertions } = opts;
  const client = new Anthropic({ apiKey });

  const system = getOrchestratorSystemPrompt(persona);
  const userMessageContent = getOrchestratorUserPrompt(assertions);

  const messages = [{ role: 'user', content: userMessageContent }];
  let timeline = [];
  const evaluationsById = new Map();

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: { type: 'auto' },
    });

    const { content, stop_reason } = response;

    // Append assistant message (may contain text + tool_use blocks)
    messages.push({
      role: 'assistant',
      content: content,
    });

    if (stop_reason !== 'tool_use') {
      break;
    }

    // Collect tool_use blocks and execute each tool
    const toolUseBlocks = content.filter((b) => b.type === 'tool_use');
    const toolResults = [];

    for (const block of toolUseBlocks) {
      const { id: toolUseId, name: toolName, input: toolInput } = block;
      console.log('Using tool:', toolName);
      const result = await executeTool({
        toolName,
        toolInput: toolInput || {},
        context: { client, model, maxTokens, persona, frames, assertions },
      });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: result.content,
        is_error: result.isError === true,
      });

      // Capture timeline and evaluations from tool results for final return
      if (toolName === 'describe_timeline' && !result.isError) {
        try {
          const parsed = JSON.parse(result.content);
          if (Array.isArray(parsed.timeline)) timeline = parsed.timeline;
        } catch (_) {}
      }
      if (toolName === 'evaluate_assertions' && !result.isError) {
        try {
          const parsed = JSON.parse(result.content);
          const list = Array.isArray(parsed.evaluations) ? parsed.evaluations : [];
          for (const e of list) {
            const id = e.assertionId || e.id;
            if (id) evaluationsById.set(id, e);
          }
        } catch (_) {}
      }
    }

    // Append user message with tool results
    messages.push({
      role: 'user',
      content: toolResults,
    });
  }

  return {
    timeline,
    evaluations: evaluationsById,
  };
}

module.exports = {
  runAgenticPipeline,
};
