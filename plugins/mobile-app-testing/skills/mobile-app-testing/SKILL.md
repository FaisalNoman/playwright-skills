---
name: mobile-app-testing
description: Record real-device (iOS Simulator / Android emulator) test flows for your app (web or native) via tapflow's MCP server, replay them with tapflow's own CLI, and stream results into an installed e2e-dashboard.
---

# Mobile App Testing (tapflow) Installer

## What This Skill Does

Records real-device test flows for your app — web or native — against a self-hosted [tapflow](https://www.tapflow.dev) relay, using tapflow's own YAML flow format and `tapflow flow run` CLI — not a custom automation engine. Copies a small report adapter that streams results into an already-installed `e2e-dashboard` as a new category tab.

**Prerequisites (not installed or provisioned by this skill):**
- A running tapflow relay + macOS agent (`tapflow start`, or a team-operated relay) — see https://www.tapflow.dev/guide/getting-started
- The `tapflow` CLI available on PATH wherever flows will be run (`npm install -g tapflow`)
- tapflow's MCP server connected to this session (`@tapflowio/mcp-server`, see https://www.tapflow.dev/guide/mcp-server) — required only for the recording phase, not for running already-recorded flows
- Node.js ≥ 18, for the report adapter script only
- Device matrix is limited to whatever simulators/emulators are booted on the connected Mac agent — tapflow has no cloud device catalog. Testing multiple OS versions means provisioning multiple local runtimes yourself, not picking from a dropdown.

---

## Phase 1 — Discovery & Connectivity

Ask the user in one message:

| Value | How to find | Default |
|-------|-------------|---------|
| `app_type` | Ask directly: "web app or native app?" | none — required |
| `relay_url` | Ask directly | none — required |
| `relay_token` | Ask directly (a Personal Access Token from tapflow's Settings → Tokens) | none — required |
| `app_id` | App identifier used in tapflow flow YAML (`appId`) — check the project's build config (iOS bundle ID / Android `applicationId`) or ask | ask if not found |
| `flows_dir` | Where flow YAML files live | `.tapflow/flows` (tapflow's own convention — never relocate under `tests/`) |
| `dashboard_installed` | Does a `progress-server.js` from `e2e-dashboard` already exist in this project? Glob for `**/progress-server.js` containing the string `E2E Dashboard`. | if absent, skip Phase 4 |

Verify connectivity before continuing: `GET {relay_url}/api/v1/auth/me` with header `Authorization: Bearer {relay_token}`. A non-2xx response means stop and report the failure clearly — do not proceed to recording against an unreachable relay. Point the user at `tapflow doctor` / `tapflow status` for diagnosis; this skill does not diagnose tapflow's own health.

If `app_type` is `native`, continue to Phase 1b below before Phase 2. If `app_type` is `web`, skip directly to Phase 2 — nothing else in Phase 1 changes for the web path.

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

Scan the project the same way `playwright-setup` does (routes, page components, existing specs in `tests/e2e/`) to propose a short list of candidate mobile journeys (e.g. "Login", "Checkout", "Search"). Present as a multi-select. Recording is one journey at a time — there is no batch or headless recording mode.

---

## Phase 3 — Record Each Journey (interactive, via MCP)

For each selected journey:

1. Call the MCP tools `list_devices`, then `boot_device` (or `connect_device` if already booted) for the platform/device the user wants — ask once per journey, or reuse the prior answer if unchanged.
2. Call `launch_app` (or `install_app` first, if the build isn't on this device yet — reuse the build file path from Phase 1b if this is a native app that already went through it, otherwise ask the user for the build path/URL).
3. Loop: call `screenshot` and `query_ui_tree` to see the current state, decide the next action, call the matching MCP tool (`tap`, `swipe`, `type_text`, `press_key`), then describe what happened in one line and ask the user to confirm it matches intent before recording the step. If they say it's wrong, re-navigate or ask what should have happened instead of recording a bad step.
4. When the user confirms a screen state the flow should assert on going forward (e.g. "yes, that's the confirmation we want to check for"), record an `assertVisible` step targeting that element's resolved selector — prefer `id` when `query_ui_tree` exposes a stable identifier, fall back to `label` otherwise.
5. When the journey is complete, write the accumulated steps as `{flows_dir}/{journey-name}.yaml`, in tapflow's own format:

   ```yaml
   name: {journey-name}
   appId: {app_id}
   steps:
     - launchApp
     - tapOn: "Add to Cart"
     - tapOn: { id: "com.example.app:id/cart-icon" }
     - assertVisible: { label: "Checkout total", timeout: 15 }
   ```

   Use the bare-string selector form (`tapOn: "Sign in"`) when the element's visible label is what was tapped; use `{ id: ... }` when `query_ui_tree` returned a stable identifier; add `timeout` on `assertVisible`/`assertNotVisible` only when the default felt too short during recording. Never write raw tap coordinates — always a resolved selector.

**Native-only: permission and onboarding dialogs.** These have no web equivalent. Record them as ordinary `tapOn`/`assertVisible` steps — same mechanism as any other element, resolved via `query_ui_tree` like step 3 above. Do not invent conditional syntax like "tap only if visible": tapflow's flow format has no such step type, and `tapflow flow run` would not understand it. If a dialog appeared during recording, it becomes a real step in the flow; if it doesn't reliably reappear on replay (OS-level permission grants often outlive `clearState`, which resets app data, not OS consent state), that's a known flakiness source — see Common Pitfalls.

6. Call `disconnect_device` (and `shutdown_device`, if the user doesn't want the simulator left running) once all journeys for this session are recorded.

---

## Phase 4 — Wire Into e2e-dashboard (only if `dashboard_installed`)

1. Read the project's installed `progress-server.js` (path found in Phase 1).
2. Confirm it supports per-category `ext` — check that `scanTestFiles` references `cat.ext`. If it doesn't (an older install), tell the user to update/reinstall `e2e-dashboard` first (an additive, backward-compatible change) rather than patching that logic in here.
3. Find the `const CATEGORIES = [ ... ];` block (may be single- or multi-line). If a `key: 'mobile'` entry already exists, leave it as-is — this step is idempotent. Otherwise insert, immediately before the array's closing `];`:
   ```js
   { key: 'mobile', label: 'Mobile (tapflow)', icon: '📱', dir: path.join(ROOT, '.tapflow', 'flows'), prefix: '.tapflow/flows', ext: '.yaml' }
   ```
   (Adjust the `path.join(ROOT, ...)` segments if `flows_dir` differs from the default `.tapflow/flows`.)
4. Write the file back.
5. Copy this skill's `templates/tapflow-report-adapter.js` into the same directory as the installed `progress-server.js`.

---

## Phase 5 — Running Flows

Print these two commands for the user — do not execute them automatically, since running against a real device is the user's call:

```sh
tapflow flow run .tapflow/flows/*.yaml --relay <relay_url> --device "<device name>" --junit test-results/mobile/report.xml
node <reporters-dir>/tapflow-report-adapter.js --report test-results/mobile/report.xml --platform ios
```

(Swap `ios`/`android` in `--platform` for whichever device the run targeted; run the pair once per platform if flows target both.) The first command replays flows deterministically against the real device — no LLM in the loop, same result every time. The second parses the JUnit report and streams it into the dashboard if `progress-server.js` is running; it reports the correct exit code even if the dashboard isn't running.

---

## Error Handling / Limitations

- Relay/agent unreachable → stop before recording or running; point at `tapflow doctor` / `tapflow status`.
- Never write `relay_token` into a committed flow file or any version-controlled file — env var or gitignored local config only.
- This skill does not generate a CI workflow file. `tapflow flow run` + the adapter are CI-compatible by construction (see tapflow's own CI guide), but wiring that in is left to the team.
- Malformed JUnit XML at adapter run time is a hard failure (non-zero exit, clear parse error) — never silently reported as a pass.

## Common Pitfalls

| Symptom | Cause / Fix |
|---|---|
| `tapflow flow run` reports "device not found" | Device isn't booted, or its name doesn't match exactly — run `tapflow devices` to see the exact name/UDID to pass to `--device`. |
| Recorded flow fails immediately on replay | A selector recorded during exploration (label text, especially) changed, or the app needs `clearState`/`launchApp` first — check the flow's first two steps. |
| Adapter posts nothing to the dashboard | Dashboard not running, or wrong `--dashboard-url`/port — the adapter never fails the run over this, so check its own console line, not the dashboard. |
| Mobile tab doesn't appear in the dashboard | `progress-server.js` doesn't yet support per-category `ext` (see Phase 4, step 2) — update/reinstall `e2e-dashboard` first. |
| Two teammates recording flows disagree on selectors | tapflow resolves id → label → partial-label; prefer `id` selectors when available, since labels can be ambiguous across similar-looking elements. |
| A native flow fails intermittently on replay, always at a permission/onboarding step | OS-level permission grants often persist across `clearState` (which only resets app data), so a dialog recorded once may not reliably reappear — a real limitation of tapflow's deterministic replay model for native apps, not something this skill can paper over. |
