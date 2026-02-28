/**
 * Load and normalize assertions from JSON file.
 * Expected shape: array of { id?, text, type?, testStepId?, testStepDescription? }
 */

const fs = require('fs');
const path = require('path');

/**
 * Load assertions from a JSON file.
 * @param {string} assertionsPath - Path to JSON file.
 * @returns {Array<{ id: string, text: string, type?: string, testStepId?: string, testStepDescription?: string }>}
 */
function loadAssertions(assertionsPath) {
  const resolved = path.resolve(assertionsPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Assertions file not found: ${resolved}`);
  }

  const content = fs.readFileSync(resolved, 'utf8');
  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new Error(`Invalid JSON in assertions file: ${e.message}`);
  }

  const list = Array.isArray(data) ? data : (data.assertions || data.items || []);
  return list.map((item, index) => {
    const text = typeof item.text === 'string' ? item.text : (item.assertion || item.description || String(item));
    const id = item.id || `assertion-${index + 1}`;
    const type = typeof item.type === 'string' ? item.type : 'concrete';
    return {
      id,
      text,
      type,
      testStepId: item.testStepId ?? item.stepId ?? `step-${index + 1}`,
      testStepDescription: item.testStepDescription ?? item.stepDescription ?? '',
    };
  });
}

/**
 * Group assertions by testStepId for output.
 * @param {Array<{ id: string, text: string, testStepId?: string, testStepDescription?: string }>} assertions
 * @returns {Array<{ id: string, description: string, assertions: typeof assertions }>}
 */
function groupByTestStep(assertions) {
  const byStep = new Map();
  for (const a of assertions) {
    const stepId = a.testStepId || 'default';
    if (!byStep.has(stepId)) {
      byStep.set(stepId, {
        id: stepId,
        description: a.testStepDescription || '',
        assertions: [],
      });
    }
    byStep.get(stepId).assertions.push(a);
  }
  return Array.from(byStep.values());
}

module.exports = {
  loadAssertions,
  groupByTestStep,
};
