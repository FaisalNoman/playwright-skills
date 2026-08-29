# Native App Testing Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the already-shipped `mobile-app-testing` skill's `SKILL.md` with an explicit web/native app-type branch, a new Build Upload phase for native apps (real tapflow REST API calls), native-only recording guidance, and reframed docs — no new runtime template code.

**Architecture:** Pure documentation change to one file, `plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md`. Three independent regions of the same file get edited: (1) frontmatter/framing + Phase 1's discovery table, (2) a new Phase 1b inserted between Phase 1 and Phase 2, (3) Phase 3's recording guidance + the Common Pitfalls table. Each region is edited by anchoring on exact existing text, so tasks don't depend on each other's diffs landing first.

**Tech Stack:** Markdown (SKILL.md). No code, no npm dependencies, no new tests beyond grep/Node-based markdown consistency checks (this repo has no test framework for docs — matches the pattern used for the SKILL.md task in the prior `mobile-app-testing` plan).

## Global Constraints

- Documentation-only change — no new runtime template code, no changes to `tapflow-report-adapter.js`, `e2e-dashboard`'s `CATEGORIES`/`ext` support, or Phases 2/4/5 beyond the Phase 3 additions in Task 3.
- Every REST field name/endpoint used must exactly match the verified shapes below (fetched live from tapflow.dev/reference/api on 2026-08-30 — do not invent or guess field names):
  - `GET /api/v1/apps` → 200, array of `{ id, name, bundle_id_key, platform, latest_build_id, version_name, build_number, status_label, latest_uploaded_at }`.
  - `POST /api/v1/apps` — JSON body `{ name, bundle_id_key, platform }` → 201 `{ id, ok: true }`.
  - `POST /api/v1/builds` — multipart form fields `file` (required, binary), `app_id` (optional, Number), `platform` (optional, `ios`/`android`), `status` (optional, one of `Backlog`/`In Progress`/`Done`/`Rejected`), `label` (optional, free text) → 201 `{ id, app_id, version_name, build_number, bundle_id, status_label, platform, uploaded_at }`.
  - Auth on all three: header `Authorization: Bearer {relay_token}` — same token/header already used by Phase 1's `GET {relay_url}/api/v1/auth/me` connectivity check.
- `install_app`'s build-id wiring stays explicitly decoupled from the Build Upload phase — never write an example that passes a `build_id` parameter into `install_app`. tapflow's own docs call its MCP server "experimental" with unconfirmed parameter shapes; this plan does not guess.
- No new flow-YAML step syntax invented for conditional/optional dialogs — tapflow's flow format has no "tap only if visible" step type, and none is added here.
- Branch: `feat/mobile-app-testing-tapflow` (already checked out — this plan's tasks are additional commits on the same branch/PR #5, not a new branch).

---

### Task 1: Phase 1 app-type branch + doc reframing

**Files:**
- Modify: `plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md` (frontmatter `description`, "What This Skill Does" paragraph, Prerequisites list, Phase 1 discovery table)

**Interfaces:**
- Produces: an `app_type` discovery value (`web` | `native`) that Task 2's Phase 1b section gates on ("skip entirely if `app_type` is `web`").

- [ ] **Step 1: Edit the frontmatter `description`**

Find this exact line (line 3):
```
description: Record real-device (iOS Simulator / Android emulator) test flows for your web app via tapflow's MCP server, replay them with tapflow's own CLI, and stream results into an installed e2e-dashboard.
```
Replace with:
```
description: Record real-device (iOS Simulator / Android emulator) test flows for your app (web or native) via tapflow's MCP server, replay them with tapflow's own CLI, and stream results into an installed e2e-dashboard.
```

- [ ] **Step 2: Edit "What This Skill Does"**

Find this exact line (line 10):
```
Records real-device test flows for your web app against a self-hosted [tapflow](https://www.tapflow.dev) relay, using tapflow's own YAML flow format and `tapflow flow run` CLI — not a custom automation engine. Copies a small report adapter that streams results into an already-installed `e2e-dashboard` as a new category tab.
```
Replace with:
```
Records real-device test flows for your app — web or native — against a self-hosted [tapflow](https://www.tapflow.dev) relay, using tapflow's own YAML flow format and `tapflow flow run` CLI — not a custom automation engine. Copies a small report adapter that streams results into an already-installed `e2e-dashboard` as a new category tab.
```

- [ ] **Step 3: Add a device-matrix-limits bullet to Prerequisites**

Find this exact block (lines 12-16):
```
**Prerequisites (not installed or provisioned by this skill):**
- A running tapflow relay + macOS agent (`tapflow start`, or a team-operated relay) — see https://www.tapflow.dev/guide/getting-started
- The `tapflow` CLI available on PATH wherever flows will be run (`npm install -g tapflow`)
- tapflow's MCP server connected to this session (`@tapflowio/mcp-server`, see https://www.tapflow.dev/guide/mcp-server) — required only for the recording phase, not for running already-recorded flows
- Node.js ≥ 18, for the report adapter script only
```
Replace with:
```
**Prerequisites (not installed or provisioned by this skill):**
- A running tapflow relay + macOS agent (`tapflow start`, or a team-operated relay) — see https://www.tapflow.dev/guide/getting-started
- The `tapflow` CLI available on PATH wherever flows will be run (`npm install -g tapflow`)
- tapflow's MCP server connected to this session (`@tapflowio/mcp-server`, see https://www.tapflow.dev/guide/mcp-server) — required only for the recording phase, not for running already-recorded flows
- Node.js ≥ 18, for the report adapter script only
- Device matrix is limited to whatever simulators/emulators are booted on the connected Mac agent — tapflow has no cloud device catalog. Testing multiple OS versions means provisioning multiple local runtimes yourself, not picking from a dropdown.
```

- [ ] **Step 4: Add the `app_type` row and branching sentence to Phase 1**

Find this exact block (the discovery table and its intro, lines 20-24):
```
## Phase 1 — Discovery & Connectivity

Ask the user in one message:

| Value | How to find | Default |
|-------|-------------|---------|
| `relay_url` | Ask directly | none — required |
```
Replace with:
```
## Phase 1 — Discovery & Connectivity

Ask the user in one message:

| Value | How to find | Default |
|-------|-------------|---------|
| `app_type` | Ask directly: "web app or native app?" | none — required |
| `relay_url` | Ask directly | none — required |
```

Then find this exact line, immediately after the table (originally line 32, now shifted down one line by the row you just added):
```
Verify connectivity before continuing: `GET {relay_url}/api/v1/auth/me` with header `Authorization: Bearer {relay_token}`. A non-2xx response means stop and report the failure clearly — do not proceed to recording against an unreachable relay. Point the user at `tapflow doctor` / `tapflow status` for diagnosis; this skill does not diagnose tapflow's own health.
```
Replace with (same connectivity-check text, plus a new branching sentence appended after it):
```
Verify connectivity before continuing: `GET {relay_url}/api/v1/auth/me` with header `Authorization: Bearer {relay_token}`. A non-2xx response means stop and report the failure clearly — do not proceed to recording against an unreachable relay. Point the user at `tapflow doctor` / `tapflow status` for diagnosis; this skill does not diagnose tapflow's own health.

If `app_type` is `native`, continue to Phase 1b below before Phase 2. If `app_type` is `web`, skip directly to Phase 2 — nothing else in Phase 1 changes for the web path.
```

- [ ] **Step 5: Verify the edits**

Run:
```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md', 'utf8');
if (!content.startsWith('---\nname: mobile-app-testing')) throw new Error('bad frontmatter');
if (content.includes('for your web app')) throw new Error('old web-app-only phrasing still present');
if (!content.includes('app (web or native)')) throw new Error('reframed description missing');
if (!content.includes('| \`app_type\` |')) throw new Error('app_type discovery row missing');
if (!content.includes('If \`app_type\` is \`native\`, continue to Phase 1b')) throw new Error('branching sentence missing');
console.log('Task 1 edits OK');
"
```
Expected: `Task 1 edits OK`.

- [ ] **Step 6: Commit**

```bash
git add plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md
git commit -m "docs(mobile-app-testing): add web/native app-type branch, reframe docs

Interview now asks web vs native up front. Web path is unchanged.
Prerequisites/description reframed from 'your web app' to 'your app
(web or native)' since nothing in the implementation is actually
web-specific. Adds a device-matrix-limits bullet (no cloud catalog,
pinned to whatever's installed on the connected Mac agent)."
```

---

### Task 2: New Phase 1b — Build Upload (native apps only)

**Files:**
- Modify: `plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md` (insert new section between Phase 1 and Phase 2)

**Interfaces:**
- Consumes: `app_type`, `relay_url`, `relay_token`, `app_id` (bundle ID / `applicationId`) from Phase 1 (Task 1).
- Produces: nothing consumed by later tasks — Phase 1b's build id is explicitly documented as not feeding into anything downstream (see Global Constraints).

- [ ] **Step 1: Insert the new Phase 1b section**

Find this exact anchor — the end of Phase 1's section and the start of Phase 2 (this text is unaffected by Task 1's edits, since Task 1 only touches content strictly above it):
```
---

## Phase 2 — Choose Journeys
```
Replace with (inserting the new section before Phase 2, keeping the `---` separator pattern the file already uses between phases):
```
---

## Phase 1b — Build Upload (native apps only — skip entirely if `app_type` is `web`)

Ask for the build file path, if not already provided (and platform, if not inferable from the file extension: `.app.zip` / `.tar.gz` / `.tgz` → iOS, `.apk` → Android).

1. **Find or create the app entry.** `GET {relay_url}/api/v1/apps` with header `Authorization: Bearer {relay_token}`. Match an entry whose `bundle_id_key` equals the project's bundle ID / `applicationId` (from `app_id`, gathered in Phase 1).
   - Match found → use its `id` as `app_id` for the next step.
   - No match → `POST {relay_url}/api/v1/apps` with JSON body `{ "name": "<app display name>", "bundle_id_key": "<bundle id>", "platform": "ios" | "android" | "both" }` → use the returned `id`.
   - More than one match for the same `bundle_id_key` → stop and ask the user which one to use; never pick one silently.
2. **Upload the build.** `POST {relay_url}/api/v1/builds` — multipart form fields: `file` (the build binary), `app_id` (from step 1), `platform`, optionally `status` (one of `Backlog` / `In Progress` / `Done` / `Rejected`) and `label` (free-text, e.g. a branch name). Same `Authorization: Bearer {relay_token}` header.
   - Non-2xx response → stop, report the failure clearly (same fail-fast pattern as Phase 1's connectivity check). Do not proceed to Phase 2 with an unresolved build state.
3. **Report back.** Tell the user the response fields in one message: `id`, `version_name`, `build_number`, `status_label`, `uploaded_at`. This build is now tracked in tapflow's own App Center (visible in tapflow's dashboard too, not just here).

**This build id is not used anywhere else in this skill.** Phase 3's `install_app` call stays exactly as documented there — call it, observe what it actually accepts, adapt. tapflow's own docs call its MCP server "experimental" with unconfirmed parameter shapes; this skill does not guess at a `build_id` parameter that was never verified against a live instance.

---

## Phase 2 — Choose Journeys
```

- [ ] **Step 2: Verify placement and field-name accuracy**

Run:
```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md', 'utf8');
const phase1bIdx = content.indexOf('## Phase 1b — Build Upload');
const phase2Idx = content.indexOf('## Phase 2 — Choose Journeys');
const phase1Idx = content.indexOf('## Phase 1 — Discovery');
if (phase1bIdx === -1) throw new Error('Phase 1b section missing');
if (!(phase1Idx < phase1bIdx && phase1bIdx < phase2Idx)) throw new Error('Phase 1b is not positioned between Phase 1 and Phase 2');
for (const field of ['bundle_id_key', 'GET {relay_url}/api/v1/apps', 'POST {relay_url}/api/v1/apps', 'POST {relay_url}/api/v1/builds', 'version_name', 'build_number', 'status_label']) {
  if (!content.includes(field)) throw new Error('missing expected field/endpoint: ' + field);
}
if (content.includes('install_app({') || /install_app\(\s*\{\s*build_id/.test(content)) throw new Error('install_app must not be wired to a build_id — check Global Constraints');
console.log('Task 2 edits OK');
"
```
Expected: `Task 2 edits OK`.

- [ ] **Step 3: Commit**

```bash
git add plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md
git commit -m "docs(mobile-app-testing): add Phase 1b Build Upload for native apps

Actively uploads the build via tapflow's real REST API (GET/POST
/api/v1/apps for idempotent app lookup, POST /api/v1/builds for the
multipart upload) rather than just documenting App Center exists.
Deliberately does not wire the resulting build id into install_app —
that MCP tool's real parameter shape was never confirmed against a
live tapflow instance."
```

---

### Task 3: Phase 3 native-only recording guidance + Common Pitfalls row

**Files:**
- Modify: `plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md` (Phase 3 body, Common Pitfalls table)

**Interfaces:**
- Consumes: nothing new — this task only adds documentation text.
- Produces: the finished, fully self-consistent SKILL.md (this is the last task touching the file — its final step verifies the whole document, not just this task's own diff).

- [ ] **Step 1: Add the native-only permission-dialog guidance to Phase 3**

Find this exact block (the end of Phase 3's numbered list and the separator before Phase 4):
```
6. Call `disconnect_device` (and `shutdown_device`, if the user doesn't want the simulator left running) once all journeys for this session are recorded.

---

## Phase 4 — Wire Into e2e-dashboard (only if `dashboard_installed`)
```
Replace with:
```
6. Call `disconnect_device` (and `shutdown_device`, if the user doesn't want the simulator left running) once all journeys for this session are recorded.

**Native-only: permission and onboarding dialogs.** These have no web equivalent. Record them as ordinary `tapOn`/`assertVisible` steps — same mechanism as any other element, resolved via `query_ui_tree` like step 3 above. Do not invent conditional syntax like "tap only if visible": tapflow's flow format has no such step type, and `tapflow flow run` would not understand it. If a dialog appeared during recording, it becomes a real step in the flow; if it doesn't reliably reappear on replay (OS-level permission grants often outlive `clearState`, which resets app data, not OS consent state), that's a known flakiness source — see Common Pitfalls.

---

## Phase 4 — Wire Into e2e-dashboard (only if `dashboard_installed`)
```

- [ ] **Step 2: Add the new Common Pitfalls row**

Find this exact block (the last row of the Common Pitfalls table, which is also the end of the file):
```
| Two teammates recording flows disagree on selectors | tapflow resolves id → label → partial-label; prefer `id` selectors when available, since labels can be ambiguous across similar-looking elements. |
```
Replace with:
```
| Two teammates recording flows disagree on selectors | tapflow resolves id → label → partial-label; prefer `id` selectors when available, since labels can be ambiguous across similar-looking elements. |
| A native flow fails intermittently on replay, always at a permission/onboarding step | OS-level permission grants often persist across `clearState` (which only resets app data), so a dialog recorded once may not reliably reappear — a real limitation of tapflow's deterministic replay model for native apps, not something this skill can paper over. |
```

- [ ] **Step 3: Verify this task's edits and the whole file's final consistency**

Run:
```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md', 'utf8');

// This task's own edits
if (!content.includes('Native-only: permission and onboarding dialogs')) throw new Error('permission-dialog guidance missing');
if (!content.includes('always at a permission/onboarding step')) throw new Error('Common Pitfalls row missing');

// Whole-file consistency, now that all three tasks have landed
const phaseHeadings = [...content.matchAll(/^## (Phase [^\n]+)/gm)].map(m => m[1]);
const expected = [
  'Phase 1 — Discovery & Connectivity',
  'Phase 1b — Build Upload (native apps only — skip entirely if \`app_type\` is \`web\`)',
  'Phase 2 — Choose Journeys',
  'Phase 3 — Record Each Journey (interactive, via MCP)',
  'Phase 4 — Wire Into e2e-dashboard (only if \`dashboard_installed\`)',
  'Phase 5 — Running Flows',
];
if (JSON.stringify(phaseHeadings) !== JSON.stringify(expected)) {
  throw new Error('Phase heading order/text mismatch:\n' + JSON.stringify(phaseHeadings, null, 2));
}
if (content.includes('for your web app') || content.includes('test flows for your web app')) throw new Error('leftover web-app-only phrasing');
console.log('Task 3 edits OK, full-file phase order verified');
"
```
Expected: `Task 3 edits OK, full-file phase order verified`.

Also manually re-read the complete file once (`Read plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md`) and confirm it reads coherently top to bottom — table formatting intact, no orphaned separators, Phase 1b's own internal cross-references (`app_type`, `relay_url`, `relay_token`, `app_id`) all resolve to values actually introduced earlier in the document.

- [ ] **Step 4: Commit**

```bash
git add plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md
git commit -m "docs(mobile-app-testing): document native permission-dialog flakiness

Adds explicit guidance for recording permission/onboarding dialogs as
ordinary tapOn/assertVisible steps (no new flow-YAML syntax invented)
and a Common Pitfalls row naming the real flakiness risk: OS-level
permission grants often outlive clearState, which only resets app
data."
```

---

## Self-Review Notes (from writing this plan)

- **Spec coverage:** every section of the design spec (web/native branch, active Build Upload phase, decoupled install wiring, native recording guidance, device-matrix limits, reframing) maps to a task above. The spec's "Out of Scope" items (install_app build-id wiring, new flow-YAML syntax, device-matrix tooling, CI wiring, changes to the adapter/dashboard/other phases) are correspondingly absent from every task.
- **Type consistency:** field names used in Task 2 (`bundle_id_key`, `app_id`, `platform`, `status`, `label`, `id`, `version_name`, `build_number`, `bundle_id`, `status_label`, `uploaded_at`) are identical to the verified shapes listed in Global Constraints — copied once there, reused verbatim in the task, not re-derived or paraphrased.
- **No placeholders:** every step shows exact before/after text for a documentation file; no "TBD" or "add appropriate guidance" language anywhere.
- **Sequencing:** Tasks 1-3 edit disjoint regions of the same file, anchored on text untouched by the other tasks, so they can be reviewed and (if ever needed) re-ordered without one task's diff depending on another's having landed first — the only true ordering requirement is Task 3's Step 3, which verifies the *combined* result of all three tasks and therefore must run last.
