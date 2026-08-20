# playwright-setup Run-and-Fix Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `playwright-setup` dual-mode — it gains a mode-detection entry point so it can be re-invoked against an already-scaffolded project (run-and-fix, or add-tests-for-gaps), and its Verify phase actually executes the generated suite and iterates on real failures instead of only parse-checking it.

**Architecture:** All changes live in a single file, `plugins/playwright-setup/skills/playwright-setup/SKILL.md` — this is agent-instruction Markdown (a prompt an LLM follows), not executable code, so "implementation" means precise, unambiguous prose/pseudocode edits and "testing" means dry-running the modified instructions against a real scratch Playwright project (per the spec's own Testing/Verification section) rather than a unit-test suite. A new Phase 0 (Mode Detection) is inserted before today's Phase 1; Phase 1 gains an incremental-mode branch; Phase 3 gains a suite-size sanity note; Phase 4.5 is replaced wholesale (list-check → bootstrap-check → real-run → fix-loop); Phase 5's report gains a test-bug/app-bug breakdown.

**Tech Stack:** Markdown (skill instructions), TypeScript (the Playwright config/spec examples embedded in the skill text), no new dependencies.

## Global Constraints

- No changes to `e2e-dashboard` — this spec is `playwright-setup`-only (per the spec's "Explicitly Out of Scope").
- The "don't over-test" suite-size note is advisory, never a hard cap — the user can approve a larger plan as-is.
- The fix loop is capped at exactly 3 attempts, then stops and asks the user for guidance rather than continuing to iterate blindly.
- Never use `page.waitForTimeout()` for a timing-related fix — use `expect().toBeVisible()`/`waitForURL()` or a targeted timeout increase (this project's existing DO-NOT rule, reaffirmed for the fix loop specifically).
- Bootstrap install (`npm install -D @playwright/test && npx playwright install`) is lazy — it only runs once execution is actually about to happen (inside Phase 4.5), never during earlier phases, so an abandoned flow never pays the install cost.
- No swarm-mode/parallel-subagent test authoring baked into the skill text (out of scope per spec — this project already has Agent/Workflow tools at the platform level for that).
- Same `/playwright-setup` entry point — no new trigger phrase or separate skill file.

---

## Task 1: Phase 0 — Mode Detection (new section)

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md`

**Interfaces:**
- Produces: a new "## Phase 0 — Mode Detection" section, inserted before "## Phase 1 — Document Discovery", establishing three named modes later tasks reference by name: **fresh-generation** (today's flow, unchanged in shape), **run-existing** (re-verify an already-scaffolded suite, no new files), **add-tests** (existing-suite incremental mode — Task 2 depends on this name).

- [ ] **Step 1: Insert the new Phase 0 section**

Find this exact text (the end of the file's intro section, right before Phase 1's header):

```
Do NOT write any files until the user approves the plan.

---

## Phase 1 — Document Discovery
```

Replace with:

```
Do NOT write any files until the user approves the plan.

---

## Phase 0 — Mode Detection

Runs first, before any document scanning. Determine whether this project already has a Playwright suite:

1. Check whether `playwright.config.ts` (or `.js`) exists at the project root, AND at least one `*.spec.ts`/`*.spec.js` file exists anywhere under the project.
2. **Neither found → fresh-generation mode.** Proceed to Phase 1 exactly as documented below — nothing about the existing flow changes in shape.
3. **Both found → ask the user, in ONE message, which of three things they want** (use the `AskUserQuestion` tool, single-select):
   - **Run the existing suite** — re-verify what's already there through the fix loop; no new spec files are written. This routes straight to Phase 4.5 (Verify & Fix), skipping Phases 1-4 entirely. This is **run-existing mode**.
   - **Add tests for new/uncovered areas** — read the existing suite first, then scan/interview/plan/write only the gaps. This routes through Phases 1-4 with the incremental-mode behavior described in Phase 1 below, then Phase 4.5 as normal. This is **add-tests mode**.
   - **Regenerate from scratch** — falls through into fresh-generation mode above; nothing is discarded until Phase 3's approval gate, same as today.

No new trigger phrase or separate skill is needed — the same `/playwright-setup` entry point routes into whichever mode Phase 0 detects/the user picks. This is what makes the run-and-fix loop usable anytime, not just at setup time: re-invoking the skill on an already-scaffolded project naturally lands on this three-way choice.

---

## Phase 1 — Document Discovery
```

- [ ] **Step 2: Verify by reading the file back**

Confirm the new "## Phase 0 — Mode Detection" section appears exactly once, immediately before "## Phase 1 — Document Discovery", and that the three mode names (**fresh-generation**, **run-existing**, **add-tests**) are each bolded on first use — later tasks will reference these exact names.

- [ ] **Step 3: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "feat(playwright-setup): add Phase 0 mode detection (fresh-generation / run-existing / add-tests)"
```

---

## Task 2: Phase 1 — existing-suite incremental mode

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md`

**Interfaces:**
- Consumes: the **add-tests** mode name from Task 1.
- Produces: Phase 1 behavior branch that reads existing spec files before scanning docs, and a "match existing style, don't rewrite" rule for add-tests mode.

- [ ] **Step 1: Insert the add-tests-mode branch into Phase 1**

Find this exact text (the start of Phase 1, right after its header):

```
## Phase 1 — Document Discovery

Scan in this order. Stop at each level if enough info found to draft a plan.
```

Replace with:

```
## Phase 1 — Document Discovery

**If in add-tests mode (Phase 0):** before scanning docs, read the existing spec files (`tests/**/*.spec.ts` or wherever Phase 0's detection found them) to understand current coverage, fixture usage, selector conventions, and file organization. Carry this understanding into every later phase: Phase 3's plan proposes NEW tests only for gaps against the interview answers — never rewrite passing tests, never restructure existing files, and match the existing style even where it conflicts with this skill's own defaults (e.g. if the project already uses `page.locator()` CSS selectors throughout instead of `data-testid`, follow that convention for new tests rather than imposing the selector-priority list below).

Scan in this order. Stop at each level if enough info found to draft a plan.
```

- [ ] **Step 2: Verify by reading the file back**

Confirm the new paragraph sits between the Phase 1 header and the "Scan in this order..." line, and that it explicitly names "add-tests mode" matching Task 1's naming.

- [ ] **Step 3: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "feat(playwright-setup): read existing suite first in add-tests mode, match its style"
```

---

## Task 3: Phase 3 — suite-size sanity note

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md`

**Interfaces:**
- Produces: an advisory (non-blocking) suite-size check inserted into Phase 3's plan-approval step.

- [ ] **Step 1: Insert the sanity note before the approval ask**

Find this exact text (the end of Phase 3, right before its section divider):

```
Add a `.github/workflows/e2e.yml` row here when the user confirmed CI/CD in Phase 2.

Ask: "Approve this plan? Add, remove, or change anything?"

Do NOT write any files until approved.

---

## Phase 4 — Implementation
```

Replace with:

```
Add a `.github/workflows/e2e.yml` row here when the user confirmed CI/CD in Phase 2.

**Suite-size sanity check (advisory, not a hard cap):** if the proposed plan exceeds roughly 10-15 tests for any single critical flow from Phase 2, flag it in the same message as the plan and suggest trimming to the highest-value cases — unless the user's own Phase 2 "Critical flows" answer explicitly called for exhaustive coverage, in which case don't flag it. This is a suggestion the user can override by approving the plan as-is; never silently trim tests without asking.

Ask: "Approve this plan? Add, remove, or change anything?"

Do NOT write any files until approved.

---

## Phase 4 — Implementation
```

- [ ] **Step 2: Verify by reading the file back**

Confirm the sanity-check paragraph sits between the CI/CD row note and the "Ask: Approve this plan?" line, and that it's explicitly framed as advisory (the word "not a hard cap" must appear).

- [ ] **Step 3: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "feat(playwright-setup): add advisory suite-size sanity note to Phase 3 plan approval"
```

---

## Task 4: Phase 4.5 — Verify & Fix (replaces Verify)

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md`

**Interfaces:**
- Consumes: the **run-existing** mode name from Task 1 (this phase is the direct target when Phase 0 routes there).
- Produces: the expanded verify-and-fix procedure — bootstrap check, real suite execution, capped fix loop with test-bug/app-bug categorization and a `--trace on` escalation tip — that Task 5's Phase 5 report depends on (specifically: the "test bug" / "app bug" category labels, and the "3 attempts, still failing" terminal state).

- [ ] **Step 1: Replace the entire Phase 4.5 section**

Find this exact text (the complete current Phase 4.5 section):

```
## Phase 4.5 — Verify (mandatory, before reporting success)

Do NOT report the suite as ready without running this check.

1. Run: `npx playwright test --list`
2. **If it exits non-zero or prints a parse/syntax error:** fix the specific file it points to and re-run. Do not proceed to Phase 5 until this exits 0.
3. **If it exits 0:** note the total test count it reports and cross-check it against the plan's "# Tests" column from Phase 3 — if they don't match, investigate why (a `describe.skip`, a typo in a `test.describe` block, etc.) before reporting done.
4. Include the verified count in the Phase 5 report ("✓ N tests verified with `playwright test --list`") — this is the one concrete piece of evidence that the generated suite is actually runnable, not just plausible-looking code.

---

## Phase 5 — Confirm
```

Replace with:

```
## Phase 4.5 — Verify & Fix (mandatory, before reporting success)

Do NOT report the suite as ready without running this check. This phase is also the direct entry point when Phase 0 routed into **run-existing mode** — in that case, skip straight here with no Phase 1-4 work done.

### Step 1 — List check

Run: `npx playwright test --list`

**If it exits non-zero or prints a parse/syntax error:** fix the specific file it points to and re-run. Do not proceed until this exits 0.

**If it exits 0:** note the total test count it reports and cross-check it against the plan's "# Tests" column from Phase 3 (skip this cross-check in run-existing mode, where there is no Phase 3 plan to compare against) — if they don't match, investigate why (a `describe.skip`, a typo in a `test.describe` block, etc.) before proceeding.

### Step 2 — Bootstrap check (new)

If `@playwright/test` is not resolvable — not present in `package.json`'s `devDependencies`, and not present in `node_modules/@playwright` — run, in order:

```bash
npm install -D @playwright/test
npx playwright install  # installs browser binaries for the configured projects only
```

This check is lazy: it only runs here, once execution is actually about to happen. Never run it during Phase 1-3 — an abandoned flow (user declines the Phase 3 plan, or Phase 0 routes to run-existing on a project where Playwright is already present) must never pay this install cost.

### Step 3 — Actually run the suite (new)

Run: `npx playwright test --reporter=line`

This is the core change from the old Verify phase: replacing "parses" with "runs." A suite that reports "N tests parsed successfully" via `--list` can still fail every single test on a real run — this step is what actually proves the suite works.

### Step 4 — Fix loop on failures (new), capped at 3 attempts

If Step 3 reports any failures, iterate — up to 3 attempts total:

1. **Read the failure output** for each failing test: expected vs actual value, the failing selector, and any page-state snippet Playwright's error already includes.
2. **Categorize each failure explicitly, in your response to the user, as one of:**
   - **Test bug** — wrong selector, a timing issue, or a wrong expected value written during generation. The test itself is wrong, not the app.
   - **App bug** — real, broken behavior in the application under test. The test correctly caught something wrong with the app.
3. **Fix the right thing:**
   - Test bug → correct the spec file (fix the selector, fix the expected value).
   - App bug → fix the application code, and explain in your response exactly what was broken and why.
   - Timing issue (a specific kind of test bug) → add a proper `expect().toBeVisible()` / `waitForURL()` wait, or a targeted timeout increase. **Never `page.waitForTimeout()`** — this project's existing DO-NOT rule (Phase 4's "Style rules" section) applies here too, including during fixes.
4. **If a failure's cause isn't clear from the error output alone,** suggest rerunning that specific test with `--trace on` (`npx playwright test <file> --trace on`) and use the resulting trace to diagnose before guessing at a fix. Don't guess-and-check blindly — use the trace.
5. **Rerun after each fix attempt** (`npx playwright test --reporter=line`, or scope to just the previously-failing files/tests for faster iteration) and document the exact command used in your response.
6. **After 3 attempts, if some test is still red:** stop. Do not attempt a 4th fix. Report exactly what's still failing and why (per-test, with your best diagnosis even if unresolved), and ask the user for guidance rather than continuing to iterate blindly. This matches this project's own `systematic-debugging` convention of escalating after repeated failed fix attempts.

---

## Phase 5 — Confirm
```

- [ ] **Step 2: Verify by reading the file back**

Confirm: the section header changed from "Phase 4.5 — Verify" to "Phase 4.5 — Verify & Fix"; all four steps (list check, bootstrap check, real run, fix loop) are present in order; the fix loop explicitly caps at 3 attempts and explicitly forbids `page.waitForTimeout()`; the run-existing-mode entry-point note is present at the top of the section.

- [ ] **Step 3: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "feat(playwright-setup): replace list-only Verify with Verify & Fix (bootstrap, real run, capped fix loop)"
```

---

## Task 5: Phase 5 — test-bug/app-bug report breakdown

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md`

**Interfaces:**
- Consumes: the "test bug" / "app bug" category labels and the "3 attempts, still failing" terminal state from Task 4.
- Produces: an updated Phase 5 report template that includes a breakdown section whenever the fix loop ran, and a "needs your input" callout instead of a false "done" claim when something is still failing after 3 attempts.

- [ ] **Step 1: Replace the Phase 5 report template**

Find this exact text (the complete current Phase 5 report template, from its header through the closing code fence):

```
## Phase 5 — Confirm

After writing all files, report:

```
## ✓ Playwright Setup Complete

**Verified:** `npx playwright test --list` reports N tests (matches the plan).

### Files created
- playwright.config.ts
- tests/e2e/auth.spec.ts         (4 tests)
- tests/e2e/booking.spec.ts      (6 tests)
- tests/fixtures/auth.ts
- tests/fixtures/index.ts
- tests/global-setup.ts

### Categories scaffolded
- E2E / Smoke: N tests
- Security-smoke: N tests (smoke-level only — not a penetration test)   ← only if selected
- Performance-smoke: N tests (smoke-level only — not a load test)      ← only if selected

### Run tests
npx playwright test

### Run with dashboard (if e2e-dashboard is installed)
node tests/reporters/progress-server.js
# open http://localhost:7373

### Manual steps required
1. Create .env.test with TEST_EMAIL and TEST_PASSWORD
2. Add .env.test to .gitignore
3. Install Playwright browsers: npx playwright install chromium
4. [any project-specific steps found during scan]
```

Then ask: "Add the real-time test progress dashboard now? (`/e2e-dashboard` — live SSE test progress, re-run individual tests, trace viewer integration)" If yes, invoke the `e2e-dashboard` skill directly in this same session rather than just telling the user to run it themselves.
```

Replace with:

```
## Phase 5 — Confirm

After Phase 4.5 completes (whether that ran after fresh generation, add-tests, or run-existing mode), report:

```
## ✓ Playwright Setup Complete

**Verified:** `npx playwright test --list` reports N tests (matches the plan). `npx playwright test --reporter=line` run: P passed, F failed, S skipped.

### Files created
- playwright.config.ts
- tests/e2e/auth.spec.ts         (4 tests)
- tests/e2e/booking.spec.ts      (6 tests)
- tests/fixtures/auth.ts
- tests/fixtures/index.ts
- tests/global-setup.ts

### Categories scaffolded
- E2E / Smoke: N tests
- Security-smoke: N tests (smoke-level only — not a penetration test)   ← only if selected
- Performance-smoke: N tests (smoke-level only — not a load test)      ← only if selected

### Run tests
npx playwright test

### Run with dashboard (if e2e-dashboard is installed)
node tests/reporters/progress-server.js
# open http://localhost:7373

### Manual steps required
1. Create .env.test with TEST_EMAIL and TEST_PASSWORD
2. Add .env.test to .gitignore
3. Install Playwright browsers: npx playwright install chromium
4. [any project-specific steps found during scan]
```

**Whenever the Phase 4.5 fix loop ran (i.e. Step 3's initial run had any failures), add this section to the report, right after the "Verified" line:**

```
### Fix loop results
- should login with valid credentials — **test bug**: selector `[name=email]` didn't match the actual `#email-input` field; corrected and reran, now passing.
- should create a new booking — **app bug**: booking confirmation page never rendered the confirmation number; fixed `BookingConfirmation.tsx` to read it from the response body instead of a stale prop.
```

One bullet per failure that occurred during the loop (fixed or not), each explicitly labeled **test bug** or **app bug**, with a one-line description of what was wrong and what changed.

**If, after 3 fix attempts, anything is still failing:** do NOT report "✓ Playwright Setup Complete." Instead report:

```
## ⚠ Playwright Setup — Needs Your Input

N of M tests passing. Still failing after 3 fix attempts:

- should cancel a booking — inconclusive after 3 attempts: [best diagnosis so far]. Suggest rerunning with `npx playwright test tests/e2e/booking.spec.ts --trace on` to inspect the trace.

[rest of the report — files created, categories, manual steps — still included as normal]
```

Adjust file-creation and category sections to match whichever mode ran (add-tests mode: list only the NEW files/tests added, not the full pre-existing suite; run-existing mode: omit the "Files created"/"Categories scaffolded" sections entirely, since nothing was written).

Then ask: "Add the real-time test progress dashboard now? (`/e2e-dashboard` — live SSE test progress, re-run individual tests, trace viewer integration)" If yes, invoke the `e2e-dashboard` skill directly in this same session rather than just telling the user to run it themselves. Skip this ask in run-existing mode if the dashboard is already installed (check for `tests/reporters/progress-server.js`).
```

- [ ] **Step 2: Verify by reading the file back**

Confirm: the "Fix loop results" section is conditioned on the fix loop having run at all; the "Needs Your Input" report variant replaces (not supplements) the "✓ Complete" report when something's still failing after 3 attempts; the mode-specific adjustments for add-tests/run-existing are present.

- [ ] **Step 3: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "feat(playwright-setup): add test-bug/app-bug breakdown and needs-input callout to Phase 5 report"
```

---

## Task 6: Dry-run verification against a real scratch project

**Files:** none created/modified in this repo — this task exercises the modified skill instructions from Tasks 1-5 against a temporary scratch project outside this worktree, per the spec's own "Testing / Verification" section (this is agent-instruction Markdown, not executable code, so there is no unit-test suite to run — dry-running the instructions against real npm/Playwright is the verification method the spec itself prescribes).

**Interfaces:** none — this is a verification-only task; if it finds a real defect in the Tasks 1-5 prose, fix the specific defect in `SKILL.md` and note it in the report, but do not add new behavior beyond what Tasks 1-5 already specified.

- [ ] **Step 1: Build a scratch project with a deliberately broken test**

In a temp directory (NOT inside this worktree — use the session scratchpad or `os.tmpdir()`-equivalent), create a minimal real project:
- A trivial static HTML page served locally (e.g. `npx serve` or a one-line Node `http.createServer`) with a real, findable element (e.g. `<h1 id="page-title">Hello</h1>`).
- A real `playwright.config.ts` (`testDir: './tests/e2e'`, a `webServer` block pointing at the static page, one `chromium` project).
- A real `tests/e2e/example.spec.ts` with ONE test that deliberately uses a WRONG selector (e.g. asserts on `#pge-title` — a typo — instead of `#page-title`), so `npx playwright test` fails predictably with a clear "element not found" error.
- Run `npm install -D @playwright/test && npx playwright install chromium` for real, so the bootstrap-check path (Step 2 below) exercises the "already present" branch first.

- [ ] **Step 2: Dry-run the fresh-generation → Phase 4.5 fix-loop path**

Acting as the agent following the newly-written Phase 4.5 instructions (Task 4's text) against this scratch project:
1. Run `npx playwright test --list` — confirm it exits 0 and reports 1 test.
2. Confirm the bootstrap check correctly finds `@playwright/test` already present (in `node_modules` from Step 1) and does NOT attempt to reinstall it.
3. Run `npx playwright test --reporter=line` for real — confirm it fails with a selector-not-found error on the planted bug.
4. Follow the fix-loop instructions: read the failure output, categorize it (this should clearly be a **test bug** — a typo'd selector, not a real app problem), fix the spec file's selector, rerun, confirm it now passes.
5. Confirm this completes in 1 fix attempt (well under the 3-attempt cap).

- [ ] **Step 3: Dry-run the Phase 5 report for the fresh-generation path**

Write out (in your report to the controller, not to any project file) what the actual Phase 5 report would say for this run, following Task 5's template — confirm it would include a "Fix loop results" section with exactly one bullet labeled **test bug**, and that the "Verified" line would show the real P/F/S counts from your Step 2 run.

- [ ] **Step 4: Dry-run the Phase 0 re-entry path**

Using the same scratch project (now with a real, passing `playwright.config.ts` + spec file in place):
1. Confirm Phase 0's detection logic (Task 1's text) would correctly identify this as an existing suite (`playwright.config.ts` exists, at least one `*.spec.ts` exists).
2. Confirm the three-way choice text from Task 1 reads sensibly when actually presented for this concrete project (not just in the abstract).
3. Manually trace "run-existing mode": confirm it routes straight to Phase 4.5 per Task 4's text, skipping Phases 1-4, and that Phase 4.5's `--list` count cross-check is correctly skipped in this mode (no Phase 3 plan exists to compare against, per Task 4's text).

- [ ] **Step 5: Dry-run the bootstrap-path negative case**

Temporarily rename/remove `node_modules/@playwright` (or use a fresh second scratch project without `npm install` ever having run) and confirm: `package.json` has no `@playwright/test` devDependency and `node_modules/@playwright` doesn't exist, so per Task 4's bootstrap-check text, the install commands (`npm install -D @playwright/test && npx playwright install`) WOULD be triggered — you don't need to actually wait through a real install a second time if Step 1 already did one; confirming the detection condition is correctly false→triggers is sufficient. Restore/reuse Step 1's already-installed scratch project afterward if you removed anything.

- [ ] **Step 6: Clean up**

Remove the scratch project's temp directory. Confirm (via `git status` in this worktree) that nothing in the actual repo was touched by this task's scratch work — only Steps 1-5's findings (if any required a fix to `SKILL.md` itself) should appear as a diff.

- [ ] **Step 7: Commit (only if Step 1-5 surfaced a real defect requiring a SKILL.md fix)**

If everything in Steps 2-5 matched the documented behavior exactly, there is nothing to commit — report that plainly. If a genuine defect in the Tasks 1-5 prose was found and fixed, commit it:

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "fix(playwright-setup): <specific defect found during dry-run verification>"
```

---

## Explicitly Out of Scope

- Any change to `e2e-dashboard`.
- A hard, non-overridable cap on suite size.
- Swarm-mode-style parallel test authoring baked into the skill text.
