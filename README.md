# UX Assertion Video Validator

CLI pipeline that validates designer-authored natural language UX assertions against a screen recording of a mobile app, using Claude (VLM) to produce pass/fail/uncertain verdicts with confidence and evidence.

## Requirements

- Node.js (current LTS recommended)
- FFmpeg (used via `ffmpeg-static`; no system install required)
- Anthropic API key

## Setup

```bash
npm install
```

Add your API key to `.env`:

```
ANTHROPIC_API_KEY=your_key_here
```

## Usage

```bash
node src/index.js --video path/to/recording.mp4 --assertions path/to/assertions.json [options]
```

### Options

| Option | Short | Description |
|--------|--------|-------------|
| `--video` | `-v` | Path to MP4 screen recording (required) |
| `--assertions` | `-a` | Path to JSON file with UX assertions (required) |
| `--output` | `-o` | Write results to this file (default: stdout) |
| `--fps` | | Override frame sampling rate (default: 1) |
| `--persona` | `-p` | `ux-designer` \| `qa-engineer` \| `none` (default: ux-designer) |
| `--keep-frames` | | Keep extracted frames in `tmp/` after run |
| `--agent` | | Use agentic pipeline (default: true). Set to false to use legacy pipeline. |
| `--legacy` | | Use legacy pipeline (same as `--no-agent`). Strategy then applies: single / batch / two-pass. |

### Global config

Create `validator.config.json` in the project root to set defaults:

```json
{
  "fps": 1,
  "persona": "ux-designer",
  "useAgent": true,
  "strategy": "two-pass"
}
```

Environment overrides: `VALIDATOR_FPS`, `VALIDATOR_PERSONA`, `VALIDATOR_STRATEGY`, `VALIDATOR_USE_AGENT`.

### Agentic architecture (default)

By default the validator runs an **agentic pipeline**:

1. **Orchestrator agent** — A single Claude instance with access to tools. It receives the assertions and is instructed to validate them against the video.
2. **Tools** — The orchestrator calls:
   - **describe_timeline** — Analyzes extracted frames and returns a structured timeline (key moments with timestamps).
   - **evaluate_assertions** — Takes the timeline and returns pass/fail/uncertain verdicts with confidence and evidence for each assertion.

The orchestrator decides when to call each tool; the host runs the tool (using the same VLM logic as before) and returns results. Output format is unchanged (same JSON with `videoMetadata` and `testSteps`).

Example (agentic, default):

```bash
node src/index.js -v recording.mp4 -a assertions.json -o out.json
```

To use the legacy pipeline instead (strategy-based):

```bash
node src/index.js -v recording.mp4 -a assertions.json --legacy --strategy two-pass -o out.json
```

### Legacy strategies (when `--legacy` or `useAgent: false`)

| Strategy    | Description |
|------------|-------------|
| **single** | One VLM call **per assertion**, each with the full video (sampled frames) + that assertion. More API calls, focused reasoning per assertion. |
| **batch**   | **One** VLM call with the full video + all assertions; output is all evaluations. Fewer calls, shared context across assertions. |
| **two-pass** | Pass 1: Claude describes the video as a timeline from sampled frames. Pass 2: Claude evaluates all assertions against that timeline (no images in pass 2). |

Example:

```bash
node src/index.js -v recording.mp4 -a assertions.json --legacy --strategy single -o out.json
node src/index.js -v recording.mp4 -a assertions.json --legacy --strategy batch -o out.json
node src/index.js -v recording.mp4 -a assertions.json --legacy --strategy two-pass -o out.json
```

## Assertions JSON format

Array of objects with:

- `id` (optional) — assertion id
- `text` (required) — natural language assertion
- `type` (optional) — `concrete` | `subjective` | `behavioral` (defaults to `concrete` if omitted)
- `testStepId` (optional) — step to group results
- `testStepDescription` (optional) — step description

Example: see `sample-assertions.json`.

## Output

JSON with `videoMetadata` and `testSteps`. Each step has `assertions` with:

- `verdict`: `pass` | `fail` | `uncertain`
- `confidence`: 0–1
- `evidence`: array of `{ timestampSeconds, frameIndex?, description }`
- `explanation`: short text

## Flow

1. **Frame extraction** — FFmpeg samples frames at the configured fps (default 1).
2. **Pipeline** (depends on `useAgent` / `--agent` / `--legacy`):
   - **Agentic (default):** Orchestrator agent calls `describe_timeline` then `evaluate_assertions`; host runs each tool (same VLM logic) and returns results to the agent.
   - **Legacy:** Same as before — single / batch / two-pass strategy (see Legacy strategies above).
3. Results are grouped by `testStepId` and written to stdout or `--output`.

## Personas

- **ux-designer** — Senior UX designer reviewing flow and feedback.
- **qa-engineer** — QA engineer evaluating assertions with precise timestamps.
- **none** — No persona framing.

## License

MIT
