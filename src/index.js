/**
 * UX Assertion Video Validator — main pipeline.
 * CLI: node src/index.js --video <path> --assertions <path> [--output <path>] [--fps N] [--persona ux-designer|qa-engineer|none]
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { loadSettings, SUPPORTED_STRATEGIES } = require('../config/settings');
const { extractFrames } = require('./videoProcessor');
const { loadAssertions, groupByTestStep } = require('./assertions');
const { runPipeline } = require('./claudeAgent');
const { appendResultsToCsv } = require('./csvResults');

const argv = yargs(hideBin(process.argv))
  .option('video', {
    alias: 'v',
    type: 'string',
    description: 'Path to screen recording MP4',
    demandOption: true,
  })
  .option('assertions', {
    alias: 'a',
    type: 'string',
    description: 'Path to JSON file with UX assertions',
    demandOption: true,
  })
  .option('output', {
    alias: 'o',
    type: 'string',
    description: 'Path to write evaluation JSON (default: stdout)',
  })
  .option('fps', {
    type: 'number',
    description: 'Override frames-per-second for sampling (default from config)',
  })
  .option('persona', {
    alias: 'p',
    type: 'string',
    choices: ['ux-designer', 'qa-engineer', 'none'],
    description: 'Override persona (default from config)',
  })
  .option('strategy', {
    type: 'string',
    choices: SUPPORTED_STRATEGIES,
    description: 'Evaluation strategy (default: two-pass)',
  })
  .option('keep-frames', {
    type: 'boolean',
    default: false,
    description: 'Keep extracted frames on disk after run',
  })
  .help()
  .argv;

const overrides = {};
if (argv.fps != null) overrides.fps = argv.fps;
if (argv.persona != null) overrides.persona = argv.persona;
if (argv.strategy != null) overrides.strategy = argv.strategy;

const settings = loadSettings(overrides);
const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.log('Error: ANTHROPIC_API_KEY is not set. Add it to .env or export it.');
  process.exit(1);
}

const videoPath = path.resolve(argv.video);
const assertionsPath = path.resolve(argv.assertions);
const outPath = argv.output ? path.resolve(argv.output) : null;
const keepFrames = argv.keepFrames;

const framesDir = path.join(process.cwd(), 'tmp', 'frames-' + Date.now());

async function run() {
  const startTimestamp = Date.now();
  console.log('Loading assertions...');
  const assertions = loadAssertions(assertionsPath);
  if (assertions.length === 0) {
    console.log('No assertions found in', assertionsPath);
    process.exit(1);
  }
  console.log('Assertions loaded:', assertions.length);

  console.log('Extracting frames (fps=%s)...', settings.fps);
  const { durationSeconds, frames } = await extractFrames(videoPath, settings.fps, framesDir);
  console.log('Frames extracted:', frames.length);

  if (frames.length === 0) {
    console.log('No frames extracted. Check video path and format.');
    process.exit(1);
  }
 
  console.log('Running Claude %s pipeline (persona=%s)...', settings.strategy, settings.persona);
  const { timeline, evaluations } = await runPipeline({
    apiKey,
    model: settings.model,
    maxTokens: settings.maxTokens,
    persona: settings.persona,
    strategy: settings.strategy,
    frames,
    assertions,
  });

  const steps = groupByTestStep(assertions);
  const testSteps = steps.map((step) => {
    const stepAssertions = step.assertions.map((a) => {
      const ev = evaluations.get(a.id) || {};
      return {
        id: a.id,
        text: a.text,
        verdict: ev.verdict || 'uncertain',
        confidence: typeof ev.confidence === 'number' ? ev.confidence : 0,
        evidence: Array.isArray(ev.evidence) ? ev.evidence : [],
        explanation: ev.explanation || '',
      };
    });
    return {
      id: step.id,
      description: step.description,
      assertions: stepAssertions,
    };
  });

  const output = {
    videoMetadata: {
      path: videoPath,
      durationSeconds,
      frameSampling: {
        mode: 'uniform',
        fps: settings.fps,
        frameCount: frames.length,
      },
    },
    testSteps,
  };

  const json = JSON.stringify(output, null, 2);

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json, 'utf8');
    console.log('Results written to', outPath);

    // // Append one row per assertion to the results CSV (create file with headers if needed).
    // const csvPath = path.join(process.cwd(), 'validation-results.csv');
    // const csvRows = assertions.map((a) => ({
    //   fps: settings.fps,
    //   persona: settings.persona,
    //   strategy: settings.strategy,
    //   text: a.text,
    //   type: a.type || 'concrete',
    //   testStepDescription: a.testStepDescription || '',
    //   resultJson: json,
    // }));
    // appendResultsToCsv(csvPath, csvRows);
    // console.log('Appended', csvRows.length, 'row(s) to', csvPath);
  } else {
    console.log(json);
  }

  if (!keepFrames && fs.existsSync(framesDir)) {
    try {
      for (const f of fs.readdirSync(framesDir)) {
        fs.unlinkSync(path.join(framesDir, f));
      }
      fs.rmdirSync(framesDir);
    } catch (e) {
      console.warn('Could not remove temp frames dir:', e.message);
    }
  }
  const endTimestamp = Date.now();
  const duration = endTimestamp - startTimestamp;
  console.log('Validation completed in', duration, 'milliseconds');
}

run().catch((err) => {
  console.log(err);
  process.exit(1);
});
