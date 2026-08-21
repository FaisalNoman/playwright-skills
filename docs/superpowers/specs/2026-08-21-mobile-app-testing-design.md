# Mobile App Testing (tapflow integration) — Design Spec

**Status:** Design approved (analysis-only session — no implementation planned yet). See "Next Session" at the bottom.

## Problem

`playwright-setup` and `e2e-dashboard` cover web E2E via Playwright, including Playwright's own device-emulation presets (viewport + UA spoofing on desktop browser engines). That's an *approximation* of mobile rendering — it never runs on a real mobile OS, and there is no path today to verify the app on an actual iOS Simulator or Android emulator/device, with real touch input and real Safari/Chrome-for-Android. There's also no way to see those results alongside the existing Playwright suite in the live dashboard.

[tapflow](https://github.com/jo-duchan/tapflow) is a self-hosted relay + macOS agent that streams real iOS Simulator / Android emulator sessions to a browser, forwards touch input, and exposes an MCP server + REST API for programmatic control (screenshot, tap, deeplink). It has **no CDP/WebDriver bridge** — no locators, no DOM access, no assertion API. Its automation surface is tap-by-coordinate plus screenshot comparison, driven either by its own deterministic flow runner or by an LLM agent through MCP.

## Scope

- **Fidelity target:** the user's own web app, rendered on a real iOS Simulator and/or Android emulator via tapflow — not native/hybrid app testing, not a tapflow reimplementation.
- **Automation model:** a real-device automated test tier, run alongside (not replacing) the existing Playwright suite. Flows are tap/screenshot sequences, not locator-based specs — this is a different, fuzzier paradigm than Playwright's, and the design treats it as a supplement, never a drop-in replacement.
- **Skill shape:** a new third skill, `mobile-app-testing`, alongside `playwright-setup` and `e2e-dashboard`. Kept separate because the automation model doesn't fit either existing skill's SKILL.md without diluting their Playwright-specific docs.
- **tapflow lifecycle:** out of scope. The new skill assumes a tapflow relay + macOS agent is already running (team-operated or local `tapflow start`); it verifies connectivity at interview time and documents tapflow as a prerequisite, but never installs/provisions it.
- **Flow authoring:** interactive only. Claude connects to tapflow's MCP server during the skill's interview, drives the real simulator itself (screenshot → decide tap → confirm with user) to record each journey, then saves it as a flow file. No batch/headless recording, no import-existing-flows mode.
- **Reporting:** unified into the existing `e2e-dashboard`, as a new category tab, reusing its SSE/event plumbing rather than a standalone view.
- **CI:** explicitly out of scope. tapflow agents need real macOS hardware with booted simulators — not something this design tries to make CI-portable. Flows run on-demand, locally or from the dashboard.

## Architecture

```
Claude Code (mobile-app-testing skill)
   │
   ├─ Phase A: RECORD
   │   interview → verify tapflow relay/token → boot real iOS Sim /
   │   Android emulator via MCP → Claude walks the journey (tap,
   │   screenshot, vision-verify) → user confirms each step →
   │   saves tests/mobile/<flow-name>.flow.json + reference screenshots
   │
   ├─ Phase B: RUN
   │   tapflow-flow-runner.js reads tests/mobile/*.flow.json → replays
   │   each step via tapflow's REST API (tap coords, screenshot,
   │   vision-compare against reference) → POSTs begin/testBegin/testEnd
   │   events to progress-server.js's existing POST /event endpoint
   │
   └─ Phase C: VIEW
       e2e-dashboard, new "mobile" category tab — reuses existing
       sidebar/SSE/artifact-panel code unmodified
```

Three approaches were considered for the run/report link:

- **A (chosen) — flow runner POSTs directly to `progress-server.js`'s existing `POST /event`.** Confirmed by reading `progress-server.js`: this endpoint already accepts arbitrary `{type: 'begin'|'testBegin'|'testEnd', ...}` JSON and applies it via `applyEvent()` before broadcasting over SSE — it was built to receive events from `realtime-reporter.js`, but nothing about it is Playwright-specific. No new server code needed for the wire protocol itself.
- **B — hook mobile runs into Playwright's reporter API**, e.g. wrap tapflow calls inside a fake Playwright test so `realtime-reporter.js` picks it up unmodified. Rejected: forces a real-device tap/screenshot flow to pretend to be a Playwright test, which misrepresents failures (a tap timeout isn't a Playwright assertion failure) and couples the mobile runner to `playwright test`'s process lifecycle for no benefit.
- **C — fully separate dashboard/report for mobile flows.** Considered and rejected per the "Reporting" scope decision above — two places to check test health was explicitly ruled out in favor of one dashboard.

## Components

### `mobile-app-testing` (new skill)

- **Interview:** after the standard project-context scan, ask for tapflow relay URL + token (PAT or agent-scope, per what the operation needs), verify connectivity before continuing. Then propose journeys to record — same discovery pattern as `playwright-setup`'s scenario proposals (scan routes/docs, present a multi-select), not reinvented.
- **Recording:** per journey, connect to tapflow's MCP server, boot the requested device (`platform`/`device` from the interview), and walk the flow step by step. Each tap is Claude's own visual judgment on the live screenshot stream; the user confirms intent matched before the step is saved. Output: `tests/mobile/<flow-name>.flow.json` plus the reference screenshots taken at each step.
- **Flow file format:**

  ```json
  {
    "name": "checkout-happy-path",
    "platform": "ios",
    "device": "iPhone 15 Pro",
    "steps": [
      { "action": "launch", "deeplink": "myapp://home" },
      { "action": "tap", "target": "Add to Cart button", "x": 210, "y": 640, "screenshot": "step-1.png" },
      { "action": "tap", "target": "Cart icon", "x": 340, "y": 60, "screenshot": "step-2.png" },
      { "action": "assert-visible", "target": "Checkout total", "screenshot": "step-3.png" }
    ]
  }
  ```

  `x`/`y` are ground-truth coordinates captured at record time. `target` is a human-readable label used both for the dashboard's step name and to let the runner re-locate the element visually (small tolerance) if layout drifted slightly since recording. `assert-visible` is the closest analog to a Playwright assertion — a vision-based screenshot comparison, not a DOM check.

### `tapflow-flow-runner.js` (new template, ships with the skill)

- CLI: `node tapflow-flow-runner.js [flow-name...]` — no args runs every `tests/mobile/*.flow.json`.
- Per flow: optionally POST `begin` to the dashboard (dashboard connection is optional — the runner works standalone from a terminal too, per the "local-only" scope). Per step: replay via tapflow REST (tap/deeplink), screenshot, vision-compare against the recorded reference, POST `testBegin`/`testEnd` with `browser: "mobile:<platform>"` and `file: "tests/mobile/<flow-name>.flow.json"` so results slot into the dashboard's existing file-based grouping.
- One retry per `assert-visible` step before marking it failed — a deliberate, visible tolerance for screenshot-comparison fuzziness (the retry itself appears in the step log, not hidden).
- Failure captures a diff screenshot + short mismatch description, attached the same way existing trace/screenshot artifacts attach.
- Exit code reflects overall pass/fail. Explicitly refuses a `--ci` style invocation rather than half-supporting it — matches the "local/team QA only" decision.

### `e2e-dashboard` (one small, additive change)

- `CATEGORIES` is currently dir + fixed-glob (`tests/<category>/*.spec.ts`). Extend each entry to carry its own file glob (default stays `*.spec.ts` — zero behavior change for existing Playwright-only projects), so `mobile-app-testing`'s adapt step can register `tests/mobile` → `*.flow.json`.
- No other change: sidebar rendering, SSE broadcast, artifact panel, category tabs (already hidden when only one category has files, per existing behavior) all work unmodified because the event shape and file-grouping logic already generalize past Playwright specifically.

## Data Flow (one mobile flow run, end to end)

`node tapflow-flow-runner.js checkout-happy-path` (or triggered from the dashboard's Run control once mobile shows as a category) → runner POSTs `begin` → for each step: tap/deeplink via tapflow REST → screenshot → vision-compare vs. reference (retry once on mismatch) → POST `testBegin`/`testEnd` tagged `browser: "mobile:ios"`, `file: "tests/mobile/checkout-happy-path.flow.json"` → `progress-server.js` applies via the existing `applyEvent()`, broadcasts over SSE → dashboard's mobile category tab shows live step-by-step progress, final pass/fail, and the diff screenshot on any failed step.

## Error Handling / Edge Cases

- Relay/agent unreachable at record or run time → fail fast with a message pointing at tapflow's own `tapflow doctor`/`tapflow status` — this skill doesn't attempt to diagnose tapflow's own health.
- Token/secret handling follows the same convention already used elsewhere in this repo's skills (env var / gitignored local config) — never written into the committed `.flow.json` files.
- `assert-visible` mismatch after the one allowed retry → step fails, diff screenshot attached, flow marked failed — no silent pass.
- A flow referencing a device/platform tapflow reports as unavailable (e.g. simulator not booted, agent offline) → runner fails that flow immediately with a clear device-unavailable message, not an indefinite "running" state.
- `--ci` or non-interactive invocation attempts → runner refuses with a message explaining mobile flows are local/on-demand only (per explicit scope decision, not an oversight).

## Testing

- `tapflow-flow-runner.js`'s pure logic — flow-file parsing/validation, `/event` payload construction, retry bookkeeping — gets `node:test` coverage mockable without a live tapflow relay, mirroring the existing `e2e-dashboard` test suite's style.
- The MCP-driven recording phase and the `CATEGORIES` glob extension are verified manually against a real tapflow instance during implementation — inherently not unit-testable, since they depend on live vision judgment and a live relay/agent, same as how `e2e-dashboard`'s own template code is dev-verified today.
- Backward-compat assertion for the `CATEGORIES` change: an existing single/multi-category Playwright-only project fixture behaves identically to today (default glob unchanged, no mobile tab appears without `tests/mobile/*.flow.json` present).

## Explicitly Out of Scope

- Native/hybrid mobile app testing (installed `.app`/`.apk`, React Native, Flutter) — this design covers the user's *web app* rendered on real mobile OS simulators, not native app automation.
- tapflow installation/provisioning (`tapflow setup`, agent bootstrapping) — assumed pre-existing infrastructure.
- CI wiring of any kind.
- Locator-based or DOM-level assertions for mobile flows — tapflow provides no such API; this is accepted as an inherent fidelity trade-off of the real-device approach, not something this design works around.
- Non-interactive/batch flow recording, or importing flows authored directly in tapflow's own UI.

## Next Session

Per the brainstorming skill's process, this spec is written and self-reviewed; the remaining steps are:
1. You review this spec file and confirm/request changes.
2. Invoke `superpowers:writing-plans` to produce the task-by-task implementation plan.
3. Execute the plan — implementation was explicitly deferred for this session ("no code change, just analysis").
