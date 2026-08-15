# Playwright-Setup Skill Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the incorrect `test.skip()`/`test.fixme()` guidance, add a post-generation verification step, generate a CI workflow when the user says tests will run in CI, turn unexplained opinionated defaults into an asked question, and auto-offer the `/e2e-dashboard` handoff instead of just printing a text hint.

**Architecture:** `playwright-setup` is a pure prompt skill (`SKILL.md`, no code) — there is no code to unit test. "Tests" for this plan are verification steps: re-reading the edited section against the specific gap it closes, and (for Task 2) grepping the final SKILL.md for the corrected phrase so a future edit can't silently regress it back.

**Tech Stack:** Markdown (SKILL.md) + one new embedded YAML template (GitHub Actions workflow, written into the *generated* project by the skill, not part of this repo's own CI).

## Global Constraints

- Single file to edit: `plugins/playwright-setup/skills/playwright-setup/SKILL.md`. Do not restructure phases wholesale — each task is a targeted, independently-reviewable edit to one phase.
- Do not implement live-selector verification (crawling the running app via a browser-automation skill) in this plan — it's a legitimate improvement from the analysis but is a much larger cross-skill integration (interview flow changes, new dependency on an installed browser-automation skill being present) that deserves its own plan. This plan explicitly notes it as a follow-up instead of half-implementing it.

---

### Task 1: Correct the `test.skip()` vs `test.fixme()` guidance

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md:321`

**Interfaces:**
- Consumes: nothing.
- Produces: corrected guidance matching Playwright's own convention (`fixme()` = known-broken, needs fixing later; `skip()` = conditionally not applicable given current config/environment).

- [ ] **Step 1: Replace the line**

Replace `SKILL.md:321`:

```markdown
- Use `test.fixme()` with a reason for known-broken flows (not `test.skip()`) — `fixme()` signals "this needs fixing", `skip()` signals "not applicable right now" (e.g. feature-flagged off, wrong environment)
```

- [ ] **Step 2: Verify**

`grep -n "test.fixme\|test.skip" plugins/playwright-setup/skills/playwright-setup/SKILL.md` — confirm the corrected line reads `fixme()` for known-broken and `skip()` for conditional, with no remaining instance of the old inverted phrasing ("Use test.skip() ... not test.fixme()").

- [ ] **Step 3: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "fix(playwright-setup): correct inverted test.skip()/test.fixme() guidance"
```

---

### Task 2: Post-generation verification step (Phase 4.5)

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md` (insert a new phase between Phase 4 and Phase 5, i.e. after line 281 / before line 282's `## Phase 5 — Confirm`)

**Interfaces:**
- Consumes: nothing.
- Produces: a mandatory check that the generated specs actually parse before the skill reports success, closing the "no execution safety net" gap identified in the analysis.

- [ ] **Step 1: Insert the new phase**

Insert immediately before `## Phase 5 — Confirm` (`SKILL.md:284`):

```markdown
---

## Phase 4.5 — Verify (mandatory, before reporting success)

Do NOT report the suite as ready without running this check.

1. Run: `npx playwright test --list`
2. **If it exits non-zero or prints a parse/syntax error:** fix the specific file it points to and re-run. Do not proceed to Phase 5 until this exits 0.
3. **If it exits 0:** note the total test count it reports and cross-check it against the plan's "# Tests" column from Phase 3 — if they don't match, investigate why (a `describe.skip`, a typo in a `test.describe` block, etc.) before reporting done.
4. Include the verified count in the Phase 5 report ("✓ N tests verified with `playwright test --list`") — this is the one concrete piece of evidence that the generated suite is actually runnable, not just plausible-looking code.

---
```

- [ ] **Step 2: Reference it from Phase 5's report template**

In the Phase 5 report template (`SKILL.md:288-311`), replace the line `### ✓ Playwright Setup Complete`:

```markdown
### ✓ Playwright Setup Complete

**Verified:** `npx playwright test --list` reports N tests (matches the plan).
```

- [ ] **Step 3: Verify**

Re-read the inserted Phase 4.5 section: confirm it (a) names the exact command, (b) states the pass/fail condition, (c) says explicitly not to proceed on failure — these are the three things that turn "no execution safety net" into an actual gate, per the analysis gap.

- [ ] **Step 4: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "feat(playwright-setup): add mandatory Phase 4.5 verification (playwright test --list) before reporting done"
```

---

### Task 3: Generate a CI workflow when the user says tests run in CI

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md` (Phase 4, add a new numbered file after "5. Spec files"; Phase 2's CI/CD question gets a forward-reference)

**Interfaces:**
- Consumes: Phase 2's existing "CI/CD" interview answer (`SKILL.md:78`) — previously only tuned `workers`/`retries`, now also gates whether this file gets written.

- [ ] **Step 1: Add the CI workflow as file 6 in Phase 4**

Insert after the `.env.test` section (`SKILL.md:274-280`, right before `## Phase 5 — Confirm` — this lands just before the Phase 4.5 block added in Task 2, so re-anchor: insert after `.env.test`'s content, before Task 2's Phase 4.5 heading):

```markdown
### 7. `.github/workflows/e2e.yml` (only if the user confirmed CI/CD in Phase 2)

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: test-results/html-report
          retention-days: 14
```

Adapt: add `TEST_EMAIL`/`TEST_PASSWORD` (and any other `.env.test` values) as repo secrets referenced via `env:` on the `npx playwright test` step if the suite needs auth; add a `services:` block if a real backend/DB is required in CI rather than mocked.
```

- [ ] **Step 2: Cross-reference from Phase 2's CI question**

Replace the CI/CD row in the Phase 2 interview table (`SKILL.md:78`):

```markdown
| 6 | **CI/CD** | Will tests run in CI? (affects `workers`, `retries`, `forbidOnly`, and whether a `.github/workflows/e2e.yml` is generated in Phase 4) |
```

- [ ] **Step 3: Verify**

Confirm the Phase 3 plan template's "Supporting files" table (`SKILL.md:130-136`) would need `.github/workflows/e2e.yml` added as a row when CI was confirmed — add a note to that effect directly under the table:

```markdown
Add a `.github/workflows/e2e.yml` row here when the user confirmed CI/CD in Phase 2.
```

- [ ] **Step 4: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "feat(playwright-setup): generate a GitHub Actions workflow when the user confirms CI/CD"
```

---

### Task 4: Turn unexplained opinionated defaults into an asked question

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md` (Phase 2 optional-questions list; Phase 4's config template)

**Interfaces:**
- Consumes: a new optional interview answer for parallelism.

- [ ] **Step 1: Add a parallelism question to Phase 2's optional list**

In the "Optional (ask only if not inferable from code)" list (`SKILL.md:80-86`), add:

```markdown
- Run tests in parallel within a file (`fullyParallel: true`), or serially (`false`)? Default suggestion: serial (`false`) for suites sharing one seeded DB/backend state, parallel for suites that are fully state-isolated per test. Ask only if the DB/backend-sharing signal isn't clear from the earlier scan.
```

- [ ] **Step 2: Replace the hardcoded assertion in the config template**

In the `playwright.config.ts` template (`SKILL.md:158, 161`), replace:

```typescript
  fullyParallel: FULLY_PARALLEL, // from Phase 2 interview — false if tests share seeded DB/backend state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 0 : 1,
  workers: process.env.CI ? 1 : WORKERS, // from Phase 2 interview — default 2, raise if suite is fully state-isolated
```

- [ ] **Step 3: Verify**

Confirm `FULLY_PARALLEL`/`WORKERS` are listed in the "Adapt:" line right after the config template (`SKILL.md:196`) so the instruction to fill them in from the interview isn't missed — update that line:

```markdown
Adapt: remove `globalSetup` if not needed, add multiple projects if multiple baseURLs exist, fill in actual commands from package.json, substitute `FULLY_PARALLEL`/`WORKERS` from the Phase 2 answer (default `false`/`2` if the user had no preference and state-sharing signals were ambiguous).
```

- [ ] **Step 4: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "fix(playwright-setup): ask about test parallelism instead of asserting an unexplained default"
```

---

### Task 5: Auto-offer the `/e2e-dashboard` handoff

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md` (Phase 5 report template, closing note)

**Interfaces:**
- Consumes: nothing (behavioral instruction).

- [ ] **Step 1: Replace the closing note**

Replace `SKILL.md:313` (`Also note: "Run /e2e-dashboard to add the real-time test progress dashboard."`):

```markdown
Then ask: "Add the real-time test progress dashboard now? (`/e2e-dashboard` — live SSE test progress, re-run individual tests, trace viewer integration)" If yes, invoke the `e2e-dashboard` skill directly in this same session rather than just telling the user to run it themselves.
```

- [ ] **Step 2: Verify**

Re-read Phase 5 end-to-end: confirm the flow now is report → ask → (optionally) hand off, rather than report → print a hint the user has to act on separately.

- [ ] **Step 3: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "feat(playwright-setup): offer to invoke e2e-dashboard directly instead of just hinting at it"
```

---

## Explicitly out of scope for this plan (documented, not silently dropped)

- **Live selector verification** (crawling the running app via a browser-automation skill to confirm `data-testid`/ARIA selectors exist before locking them into specs, instead of guessing from static source scan) is a real gap from the analysis, but it's a cross-skill integration change (new dependency on a browser-automation skill being installed, new interview branching, a new failure mode to design for when the app isn't running yet) that deserves its own plan rather than being bolted on here.
