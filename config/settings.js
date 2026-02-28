/**
 * Global settings for the UX assertion video validator.
 * Can be overridden via CLI flags or a config file in the future.
 */

const path = require('path');
const fs = require('fs');

const DEFAULT_SETTINGS = {
  /** Frames per second for video sampling (e.g. 1 = one frame per second). */
  fps: 1,
  /** Persona for the VLM: 'ux-designer' | 'qa-engineer' | 'none' */
  persona: 'ux-designer',
  /** Evaluation strategy: 'single' (one call per assertion) | 'batch' (all in one call) | 'two-pass' (describe then evaluate). */
  strategy: 'two-pass',
  /** Claude model ID. */
  model: 'claude-sonnet-4-5',
  /** Max tokens for Claude responses. */
  maxTokens: 8192,
};

/** Strategies that are implemented and can be used for testing. */
const SUPPORTED_STRATEGIES = ['two-pass', 'batch', 'single'];

const CONFIG_FILE = path.join(process.cwd(), 'validator.config.json');

/**
 * Load settings: defaults, then config file (if present), then env/CLI overrides.
 * @param {object} overrides - Optional overrides (e.g. from CLI).
 * @returns {object} Merged settings.
 */
function loadSettings(overrides = {}) {
  let settings = { ...DEFAULT_SETTINGS };

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const content = fs.readFileSync(CONFIG_FILE, 'utf8');
      const fileConfig = JSON.parse(content);
      settings = { ...settings, ...fileConfig };
    } catch (e) {
      console.warn('Warning: could not parse validator.config.json:', e.message);
    }
  }

  // Env overrides (optional)
  if (process.env.VALIDATOR_FPS != null) {
    const fps = parseFloat(process.env.VALIDATOR_FPS);
    if (!Number.isNaN(fps) && fps > 0) settings.fps = fps;
  }
  if (process.env.VALIDATOR_PERSONA) {
    const p = process.env.VALIDATOR_PERSONA.toLowerCase();
    if (['ux-designer', 'qa-engineer', 'none'].includes(p)) settings.persona = p;
  }
  if (process.env.VALIDATOR_STRATEGY) {
    settings.strategy = process.env.VALIDATOR_STRATEGY;
  }

  const merged = { ...settings, ...overrides };
  if (!SUPPORTED_STRATEGIES.includes(merged.strategy)) {
    console.warn(
      `Warning: strategy "${merged.strategy}" is not implemented. Supported: ${SUPPORTED_STRATEGIES.join(', ')}. Using "${merged.strategy}" anyway (may behave as two-pass).`
    );
  }
  return merged;
}

module.exports = {
  DEFAULT_SETTINGS,
  SUPPORTED_STRATEGIES,
  loadSettings,
  CONFIG_FILE,
};
