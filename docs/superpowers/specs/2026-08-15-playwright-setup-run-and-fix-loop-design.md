# playwright-setup Run-and-Fix Loop — Design Spec

**Status:** Design approved. Implementation plan and build deferred to a future session — see "Next Session" at the bottom.

## Problem

Compared against a third-party skill (`playwright-tester`, `C:\Workspace\Skills\playwright-skill-by-mansel\playwright-tester\SKILL.md`), `playwright-setup`'s biggest gap is that it never actually *executes* the suite it generates. `Phase 4.5 — Verify` only runs `playwright test --list` (a syntax/count check) — it can report "47 tests parsed successfully" for a suite that fails every single one on a real run. The skill is also strictly a one-shot generator: there's no way to re-invoke it against an already-scaffolded project to re-verify after code changes, no test-bug-vs-app-bug diagnostic split, no suite-size discipline, and no bootstrap-if-Playwright-missing step.

A full comparison against the third-party skill (strengths, weaknesses, and what's worth borrowing) is captured in the session transcript; this spec covers implementing the six items that came out of it as worth borrowing.

## Scope — six items, one spec

1. **Run-and-fix loop** (highest value) — actually execute the suite and iterate on real failures, not just parse-check it.
2. **test-bug / app-bug categorization** in the fix loop and the final report.
3. **`--trace on` tip** surfaced when a failure is confusing enough to warrant it.
4. **"Don't over-test" note** during Phase 3 plan approval.
5. **Bootstrap Playwright if missing** (`npm install -D @playwright/test && npx playwright install`).
6. **Existing-suite incremental mode** — read existing tests first, add only for gaps, don't rewrite, match style.

All six are folded into one spec because #2–4 are direct extensions of #1's same phase, and #5–6 are small, cheap additions to phases that already exist.

## Architecture

**Core change: `playwright-setup` gains mode detection at entry, becoming dual-mode instead of a one-shot generator.**

A new **Phase 0 — Mode Detection** runs before today's Phase 1 (Document Discovery): check whether a `playwright.config.ts` + spec files already exist in the target project.

- **Not found** → today's flow proceeds unchanged in shape (Phase 1 → 2 → 3 → 4), but Phase 4.5 is replaced by the expanded "Verify & Fix" phase described below.
- **Found** → ask the user, in one message, which of three things they want:
  1. Run the existing suite through the fix loop (no new files, just verify + fix).
  2. Add tests for new/uncovered areas (existing-suite incremental mode — borrow #6).
  3. Regenerate from scratch (falls through into the "not found" flow above, discarding nothing until Phase 3's approval gate as usual).

No new trigger phrase or separate skill needed — same `/playwright-setup` entry point, smarter branching at the very start. This is the mechanism that makes the run-and-fix loop "usable anytime" rather than setup-time-only: re-invoking the skill on an already-scaffolded project naturally routes into option 1.

## Phase-by-phase changes

### Phase 0 — Mode Detection (new)
As described above. Runs first, before any document scanning.

### Phase 1 — Document Discovery (modified)
When in "add tests" mode (Phase 0 option 2): read existing spec files first to understand current coverage and conventions. Add new tests only for gaps identified against the interview answers — don't rewrite passing tests, don't restructure existing files, match the existing style (fixture usage, selector conventions, file organization) rather than imposing this skill's own defaults where they conflict.

### Phase 3 — Test Plan (modified)
The plan-approval message gains a suite-size sanity note: if the proposed plan exceeds roughly 10-15 tests per critical flow, flag it and suggest trimming to the highest-value cases — unless the user's own stated scope (Phase 2 "Critical flows" answer) explicitly calls for exhaustive coverage. This is advisory, not a hard cap — the user can approve a larger plan as-is.

### Phase 4.5 — Verify & Fix (replaces today's list-only "Verify")
1. `npx playwright test --list` — unchanged from today: must exit 0, count must match the Phase 3 plan.
2. **New — bootstrap check:** if `@playwright/test` isn't resolvable (not in `package.json` devDependencies / not in `node_modules`), run `npm install -D @playwright/test` then `npx playwright install` for the configured browsers only. Lazy — this only runs once execution is actually about to happen, not during earlier phases, so an abandoned flow (e.g. user declines the Phase 3 plan) never pays the install cost.
3. **New — actually run the suite:** `npx playwright test --reporter=line`. This is the core borrow: replacing "parses" with "runs."
4. **New — fix loop on failures**, capped at 3 attempts:
   - Read the failure output (expected vs actual, failing selector, page-state snippet Playwright includes).
   - Categorize each failure explicitly: **test bug** (wrong selector, timing issue, wrong expected value written during generation) vs **app bug** (real broken behavior in the application under test).
   - Fix the right thing: test bug → correct the spec file; app bug → fix the application code and explain what was broken; timing issue → add a proper `waitFor`/`toBeVisible()` wait or a targeted timeout increase, never `page.waitForTimeout()` (this project's existing DO-NOT rule already forbids it, applies here too).
   - If a failure's cause isn't clear from the error output alone, suggest rerunning that specific test with `--trace on` and use the resulting trace to diagnose before guessing at a fix.
   - Rerun after each fix attempt; document the exact command used.
   - After 3 attempts still red on some test → stop, report what's still failing and why, and ask the user for guidance rather than continuing to iterate blindly (matches this project's own `systematic-debugging` convention of escalating after repeated failed fix attempts, not coincidentally the same threshold the third-party skill independently uses).

### Phase 5 — Confirm (modified)
The report gains a test-bug/app-bug breakdown whenever the fix loop ran: total tests, passed, failed, skipped; for each failure that was fixed, whether it was a test bug or an app bug and what changed; for anything still failing after 3 attempts, a clear "needs your input" callout instead of a false "done" claim.

## Testing / Verification

This is agent-instruction Markdown, not executable code — "testing" means dry-running the modified skill against a real scratch project in both modes:
- **Fresh generation path:** confirm the expanded Phase 4.5 actually executes the generated suite (not just `--list`), correctly categorizes at least one deliberately-broken test (a wrong selector, planted on purpose) as a test bug, fixes it, and reports the fix in Phase 5.
- **Re-entry path:** confirm Phase 0 correctly detects an existing suite, offers the three-way choice, and that "run existing suite" correctly re-executes without touching Phase 1-4's generation logic.
- **Bootstrap path:** confirm the install step is skipped when `@playwright/test` is already present, and only triggers when genuinely absent.

No changes to `e2e-dashboard` are required for this spec — it's entirely internal to `playwright-setup`.

## Explicitly Out of Scope

- Any change to `e2e-dashboard` (this spec is `playwright-setup`-only).
- A hard, non-overridable cap on suite size — the "don't over-test" note is advisory.
- Swarm-mode-style parallel test authoring (the third-party skill's prose-only "spawn 3 sub-agents" idea) — this project already has stronger native orchestration (Agent/Workflow tools) available at the platform level when a user actually wants parallel work; baking a weaker prose-only version into the skill text itself would be a regression, not a borrow.

## Next Session

Per the brainstorming skill's process, this spec is written and self-reviewed; the remaining steps are:
1. You review this spec file and confirm/request changes.
2. Invoke `superpowers:writing-plans` to produce the task-by-task implementation plan.
3. Execute the plan (subagent-driven-development, matching this session's established pattern).
