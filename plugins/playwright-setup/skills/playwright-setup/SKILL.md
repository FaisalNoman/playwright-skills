---
name: playwright-setup
description: Scan project docs/source, interview user, create Playwright E2E test specs + config from scratch for any app.
---

# Playwright Setup Generator

## Goal

Produce a complete, ready-to-run Playwright E2E test suite for any project by:
1. Mining existing docs and source code for user flows
2. Interviewing the user to fill gaps and confirm scope
3. Presenting a test plan for approval
4. Writing all required files

Do NOT write any files until the user approves the plan.

---

## Phase 0 — Mode Detection

Runs first, before any document scanning. Determine whether this project already has a Playwright suite:

1. Check whether `playwright.config.ts` (or `.js`) exists at the project root, AND at least one `*.spec.ts`/`*.spec.js` file exists anywhere under the project.
2. **Config and spec files not BOTH present → fresh-generation mode.** This covers three cases: neither exists, only `playwright.config.ts` exists (a mid-setup or config-only project), or only spec files exist with no config. Proceed to Phase 1 exactly as documented below — nothing about the existing flow changes in shape. If a `playwright.config.ts` already exists in this fresh-generation path, call this out explicitly in the Phase 3 plan ("Note: this will replace the existing `playwright.config.ts`") so the approval gate in Phase 3 (`Do NOT write any files until approved`) gives the user a chance to object before it's overwritten.
3. **Both found → ask the user, in ONE message, which of three things they want** (use the `AskUserQuestion` tool, single-select):
   - **Run the existing suite** — re-verify what's already there through the fix loop; no new spec files are written. This routes straight to Phase 4.5 (Verify & Fix), skipping Phases 1-4 entirely. This is **run-existing mode**.
   - **Add tests for new/uncovered areas** — read the existing suite first, then scan/interview/plan/write only the gaps. This routes through Phases 1-4 with the incremental-mode behavior described in Phase 1 below, then Phase 4.5 as normal. This is **add-tests mode**.
   - **Regenerate from scratch** — falls through into fresh-generation mode above; nothing is discarded until Phase 3's approval gate, same as today.

No new trigger phrase or separate skill is needed — the same `/playwright-setup` entry point routes into whichever mode Phase 0 detects/the user picks. This is what makes the run-and-fix loop usable anytime, not just at setup time: re-invoking the skill on an already-scaffolded project naturally lands on this three-way choice.

---

## Phase 1 — Document Discovery

**If in add-tests mode (Phase 0):** before scanning docs, read the existing spec files (`tests/**/*.spec.ts` or wherever Phase 0's detection found them) to understand current coverage, fixture usage, selector conventions, and file organization. Carry this understanding into every later phase: Phase 3's plan proposes NEW tests only for gaps against the interview answers — never rewrite passing tests, never restructure existing files, and match the existing style even where it conflicts with this skill's own defaults (e.g. if the project already uses `page.locator()` CSS selectors throughout instead of `data-testid`, follow that convention for new tests rather than imposing the selector-priority list below).

Scan in this order. Stop at each level if enough info found to draft a plan.

### Level 1: Requirements docs (highest signal)

Check these paths (adapt to project root):
```
Documentation/Product/Product-Requirements-Document.md
Documentation/Product/User-Journey-Document.md
Documentation/Product/Feature-Ticket-List.md
docs/PRD.md
docs/requirements.md
docs/user-stories.md
README.md
FEATURES.md
```

Also check `graphify-out/GRAPH_REPORT.md` if it exists — it shows god nodes (most-connected features) and community clusters which map directly to test suites.

### Level 2: Source code scan (if docs sparse)

Scan the project source for:

| Signal | Where to look | What it tells you |
|--------|---------------|-------------------|
| Routes / pages | `src/router/`, `src/pages/`, `app/`, `pages/` | User-navigable flows |
| API endpoints | `src/routes/`, `controllers/`, `api/` | Backend features to test |
| Auth flows | `login`, `register`, `auth` in filenames | Login/logout/session tests |
| Forms | `<form>`, `v-model`, `useForm`, `handleSubmit` in source | Input validation tests |
| User roles | `role`, `permission`, `admin`, `staff` in source | Multi-role test paths |
| Navigation | `<nav>`, `<router-link>`, `<Link>` | Navigation tests |

Use `Glob` + `Grep` — do NOT read entire files. Extract the minimum needed to understand feature surface.

### Level 3: Package.json / config

Read `package.json` scripts and dependencies to understand:
- Frontend framework (React/Vue/Angular/Next.js/Nuxt)
- Build system and dev server command + URL
- Whether Playwright already exists (`@playwright/test` in devDependencies)
- Backend server command + URL

---

## Phase 2 — Interview

After scanning, fill in any gaps with ONE focused message covering ALL open questions. Never ask more than 6 questions at once.

### Required information (must have before planning)

| # | Question | Why needed |
|---|----------|-----------|
| 1 | **App type** | SPA, SSR, multi-page? Single URL or multiple? |
| 2 | **Base URLs** | Dev server URLs (frontend, admin, API) |
| 3 | **Auth** | Is login required? What credentials? How many roles? |
| 4 | **Critical flows** | Top 3–5 user journeys that MUST be tested (e.g. "register → book → cancel") |
| 5 | **Out of scope** | Any pages/flows explicitly NOT to test now |
| 6 | **Test categories** | Which test categories to scaffold — see "Test Categories" below |
| 7 | **Browser targets** | Which browsers/device profiles to configure as Playwright projects — see "Browser Targets" below. **Skip this question in add-tests mode** (Phase 0) — Phase 4 never regenerates `playwright.config.ts` in that mode, so there's nothing for the answer to drive; the existing `projects[]` array stays as-is. |
| 8 | **CI/CD** | Will tests run in CI? (affects `workers`, `retries`, `forbidOnly`, and whether a `.github/workflows/e2e.yml` is generated in Phase 4). **Skip in add-tests mode** for the same reason — no config/workflow file is regenerated. |

### Test Categories

Ask this as a dedicated multi-select question — use the `AskUserQuestion` tool with `multiSelect: true` — rather than folding it into the free-text interview message:

- **E2E / Smoke** (default selected) — user-journey specs under `tests/e2e/`. This is what Phase 3/4 already produce and is the only category most projects need.
- **Security-smoke** — `tests/security/` specs covering response security headers, an auth-bypass probe, and a reflected-input/XSS check. This is a lightweight smoke layer, **not a substitute for real penetration testing** — say so explicitly if the user's framing suggests they expect full pentest coverage.
- **Performance-smoke** — `tests/perf/` specs asserting page-load timing budgets via the browser's Navigation Timing API. This is a lightweight smoke layer, **not a substitute for real load testing** (concurrent virtual users) — say so explicitly if the user's framing suggests they expect load-test coverage.

Selecting more than one category changes `playwright.config.ts`'s `testDir` in Phase 4 and adds the corresponding spec-file sections to the Phase 3 plan and Phase 4 implementation.

### Browser Targets

Ask this as a dedicated multi-select question — use the `AskUserQuestion` tool with `multiSelect: true` — same pattern as Test Categories:

- **Chromium** (default selected) — `devices['Desktop Chrome']`. Covers most projects' needs alone.
- **Firefox** — `devices['Desktop Firefox']`.
- **WebKit** — `devices['Desktop Safari']`.
- **Microsoft Edge** — `devices['Desktop Chrome']` + `channel: 'msedge'`. Officially supported by Playwright (no separate download — it drives the OS-installed Edge).
- **Opera** — `devices['Desktop Chrome']` + `launchOptions.executablePath` pointing at the OS-installed Opera binary. Not a Playwright-managed browser — see "Opera / Brave executable resolution" below.
- **Brave** — `devices['Desktop Chrome']` + `launchOptions.executablePath` pointing at the OS-installed Brave binary. Same caveat as Opera.
- **Mobile Chrome** — `devices['Pixel 5']`. Generated project `name` must be the space-free slug `mobile-chrome` (not the display label) — Playwright project names flow through as literal `--project` CLI args, and a name containing a space breaks under the dashboard server's shell-mode process spawn.
- **Mobile Safari** — `devices['iPhone 13']`. Generated project `name` must be the space-free slug `mobile-safari`, same reasoning.

Selecting more than one target changes Phase 4's `playwright.config.ts` generation: each selection becomes its own `projects[]` entry, and the shared `use.launchOptions` block is replaced by a per-project window-positioning override (see Phase 4 below) — the single-Chromium case is unaffected and generates exactly what it does today.

### Opera / Brave executable resolution

Opera and Brave are Chromium-based but Playwright does not manage or auto-download them (no `channel` like `msedge`). The generated config resolves each one's executable path at launch time, in this order:

1. `PW_OPERA_PATH` / `PW_BRAVE_PATH` env var, if set — trusted as-is (a typo surfaces as a real launch error, not a silently-ignored override).
2. The first common per-OS install path that exists on disk (Program Files / AppData on Windows, `/Applications` on macOS, `/usr/bin` on Linux).
3. If neither resolves, a deliberately-invalid placeholder path — this only throws when that specific project is actually run (`--project opera` / `--project brave`), not at config load, so projects for browsers nobody selected never break unrelated runs.

See the `resolveExecutablePath` helper in the Phase 4 config below.

### Optional (ask only if not inferable from code)

- DB/seed setup required before tests? (`globalSetup`)
- Test data strategy: fixtures, factories, or live DB?
- Mobile viewports needed?
- Any existing test files to follow as style guide?
- Should Page Object Model pattern be used?
- Run tests in parallel within a file (`fullyParallel: true`), or serially (`false`)? Default suggestion: serial (`false`) for suites sharing one seeded DB/backend state, parallel for suites that are fully state-isolated per test. Ask only if the DB/backend-sharing signal isn't clear from the earlier scan.

**After interview**: summarise understanding in bullet form. Ask:
> "Does this capture everything? Any gaps before I plan?"

Do not proceed until confirmed.

---

## Phase 3 — Test Plan

Present as a structured table. Show EVERY planned test — not just files.

When more than one category was selected in Phase 2, group the "Files to create" and "Test titles" tables by category (E2E / Smoke, Security-smoke, Performance-smoke, in that order) instead of one flat list — each category gets its own subheading.

### Format

```
## Playwright E2E Test Plan

### Config
- Base URL(s): ...
- Browsers: ...
- Workers: ...
- Global setup: yes/no

### Files to create
| File | # Tests | Description |
|------|---------|-------------|
| tests/e2e/auth.spec.ts | 4 | Login, logout, invalid creds, session persist |
| tests/e2e/booking.spec.ts | 6 | Create, view, cancel, edit, validation, confirmation email |
| ...

### Test titles (per file)

**auth.spec.ts**
- should login with valid credentials
- should show error on invalid password
- should redirect unauthenticated users to login
- should logout and clear session

**booking.spec.ts**
- should create a new booking
- ...

### Supporting files
| File | Purpose |
|------|---------|
| playwright.config.ts | Main config |
| tests/global-setup.ts | DB seed / auth token setup |
| tests/fixtures/auth.ts | Logged-in page fixture |
| tests/fixtures/index.ts | Re-export all fixtures |
```

Add a `.github/workflows/e2e.yml` row here when the user confirmed CI/CD in Phase 2.

**Suite-size sanity check (advisory, not a hard cap):** if the proposed plan exceeds roughly 10-15 tests for any single critical flow from Phase 2, flag it in the same message as the plan and suggest trimming to the highest-value cases — unless the user's own Phase 2 "Critical flows" answer explicitly called for exhaustive coverage, in which case don't flag it. This is a suggestion the user can override by approving the plan as-is; never silently trim tests without asking.

Ask: "Approve this plan? Add, remove, or change anything?"

Do NOT write any files until approved.

---

## Phase 4 — Implementation

Write files in this order:

### 1. `playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/global-setup.ts',  // omit if no setup needed
  outputDir: './test-results/artifacts',
  fullyParallel: FULLY_PARALLEL, // from Phase 2 interview — false if tests share seeded DB/backend state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 0 : 1,
  workers: process.env.CI ? 1 : WORKERS, // from Phase 2 interview — default 2, raise if suite is fully state-isolated
  timeout: 60000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/html-report', open: 'never' }],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Interactive-mode runs (dashboard "headed" runs) get a null viewport so
    // the page content fills the real OS window instead of staying clipped
    // to Playwright's fixed 1280x720 default once that window maximizes.
    // Background/CI runs never set PW_WIN_X, so this stays undefined there —
    // screenshot dimensions on those runs are unaffected.
    viewport: process.env.PW_WIN_X != null ? null : undefined,
    launchOptions: {
      slowMo: parseInt(process.env.PLAYWRIGHT_SLOW_MO || '0', 10),
      args: process.env.PW_WIN_X != null ? [
        // Center the window's brief pre-maximize position, then maximize —
        // this is what "PW_WIN_X" now drives; the window-size args are gone
        // since --start-maximized supersedes them.
        `--window-position=${process.env.PW_WIN_X},${process.env.PW_WIN_Y || '0'}`,
        '--start-maximized',
        // Windows treats a newly-launched automated Chromium window as
        // "occluded" even though it's on top of nothing — Chrome then
        // throttles/backgrounds it, which shows up as opening minimized.
        '--disable-features=CalculateNativeWinOcclusion',
      ] : [],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:PORT' },
    },
    // Add more projects for additional URLs or browsers
  ],
  webServer: [
    {
      command: 'DEV_COMMAND',
      url: 'http://localhost:PORT',
      reuseExistingServer: !process.env.CI,
      cwd: './PACKAGE_DIR',
    },
  ],
});
```

Adapt: remove `globalSetup` if not needed, add multiple projects if multiple baseURLs exist, fill in actual commands from package.json, substitute `FULLY_PARALLEL`/`WORKERS` from the Phase 2 answer (default `false`/`2` if the user had no preference and state-sharing signals were ambiguous).

### `projects[]` when multiple browser targets were selected in Phase 2

**Single target (Chromium only, the default):** keep the `projects` array and shared `use.launchOptions` exactly as shown above — unchanged from today.

**Two or more targets:** generate one `projects[]` entry per selection, using the matching `devices[...]` preset, and replace the single shared `use.launchOptions` with a per-project index-based window-positioning override:

```typescript
import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';

// Interactive-mode windows all get the same centered-then-maximized slot
// (see progress-server.js's computeWindowLayout) — every index resolves to
// an identical position. Kept index-based (rather than one flat constant)
// so a config regenerated with a different browser count/order still works
// without edits here.
function windowArgsForProject(index: number) {
  if (process.env.PW_WIN_LAYOUT) {
    try {
      const layout = JSON.parse(process.env.PW_WIN_LAYOUT);
      const slot = layout[index] || layout[layout.length - 1];
      if (slot) {
        return [
          `--window-position=${slot.x},${slot.y}`,
          '--start-maximized',
          '--disable-features=CalculateNativeWinOcclusion',
        ];
      }
    } catch {}
  }
  return process.env.PW_WIN_X != null ? [
    `--window-position=${process.env.PW_WIN_X},${process.env.PW_WIN_Y || '0'}`,
    '--start-maximized',
    '--disable-features=CalculateNativeWinOcclusion',
  ] : [];
}

// See "Opera / Brave executable resolution" above. envVar wins if set (even
// if the path turns out wrong — that should surface as a real launch error,
// not be silently second-guessed); otherwise the first existing candidate
// wins; otherwise a deliberately-invalid path so only *this* project's runs
// fail, at launch time, not config load for every project.
function resolveExecutablePath(envVar: string, candidates: string[]): string {
  const override = process.env[envVar];
  if (override) return override;
  return candidates.find(p => p && fs.existsSync(p)) || `__${envVar}_NOT_FOUND__`;
}

const OPERA_PATH = resolveExecutablePath('PW_OPERA_PATH', [
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Programs\\Opera\\opera.exe` : '',
  'C:\\Program Files\\Opera\\launcher.exe',
  'C:\\Program Files (x86)\\Opera\\launcher.exe',
  '/Applications/Opera.app/Contents/MacOS/Opera',
  '/usr/bin/opera',
]);

const BRAVE_PATH = resolveExecutablePath('PW_BRAVE_PATH', [
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/brave-browser',
  '/usr/bin/brave',
]);

export default defineConfig({
  // ...same top-level config as the single-target case (testDir, reporter, use.trace, etc.)...
  use: {
    // ...trace, screenshot, etc. as in the single-target case...
    viewport: process.env.PW_WIN_X != null ? null : undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'], baseURL: 'http://localhost:PORT',
        launchOptions: { slowMo: parseInt(process.env.PLAYWRIGHT_SLOW_MO || '0', 10), args: windowArgsForProject(0) },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'], baseURL: 'http://localhost:PORT',
        launchOptions: { slowMo: parseInt(process.env.PLAYWRIGHT_SLOW_MO || '0', 10), args: windowArgsForProject(1) },
      },
    },
    {
      name: 'edge',
      use: {
        ...devices['Desktop Chrome'], channel: 'msedge', baseURL: 'http://localhost:PORT',
        launchOptions: { slowMo: parseInt(process.env.PLAYWRIGHT_SLOW_MO || '0', 10), args: windowArgsForProject(2) },
      },
    },
    {
      name: 'opera',
      use: {
        ...devices['Desktop Chrome'], baseURL: 'http://localhost:PORT',
        launchOptions: {
          executablePath: OPERA_PATH,
          slowMo: parseInt(process.env.PLAYWRIGHT_SLOW_MO || '0', 10),
          args: windowArgsForProject(3),
        },
      },
    },
    {
      name: 'brave',
      use: {
        ...devices['Desktop Chrome'], baseURL: 'http://localhost:PORT',
        launchOptions: {
          executablePath: BRAVE_PATH,
          slowMo: parseInt(process.env.PLAYWRIGHT_SLOW_MO || '0', 10),
          args: windowArgsForProject(4),
        },
      },
    },
    // one entry per selected target, index matching array position (0, 1, 2, ...) —
    // only include the projects actually selected in Phase 2, in selection order.
  ],
  // ...webServer unchanged...
});
```

Only include `OPERA_PATH`/`BRAVE_PATH`/`resolveExecutablePath` and the `import fs from 'fs'` line when Opera and/or Brave were actually selected — don't add unused dead code to configs that don't need it.

The mapping from Phase 2 selections to `devices[...]` presets:

| Selection | Project `name` | `devices[...]` preset | Extra `use`/`launchOptions` |
|---|---|---|---|
| Chromium | `chromium` | `devices['Desktop Chrome']` | — |
| Firefox | `firefox` | `devices['Desktop Firefox']` | — |
| WebKit | `webkit` | `devices['Desktop Safari']` | — |
| Microsoft Edge | `edge` | `devices['Desktop Chrome']` | `channel: 'msedge'` |
| Opera | `opera` | `devices['Desktop Chrome']` | `launchOptions.executablePath: OPERA_PATH` |
| Brave | `brave` | `devices['Desktop Chrome']` | `launchOptions.executablePath: BRAVE_PATH` |
| Mobile Chrome | `mobile-chrome` | `devices['Pixel 5']` | — |
| Mobile Safari | `mobile-safari` | `devices['iPhone 13']` | — |

`windowArgsForProject`'s `index` argument is that project's fixed position in the `projects[]` array (0-based) — must match the order the browsers appear in the array, since `progress-server.js`'s `PW_WIN_LAYOUT` array is ordered the same way the `--project` flags were passed on the command line, which itself follows the dashboard's selection order.

`testDir` depends on how many categories were selected in Phase 2:
- **Single category (E2E only, the default):** `testDir: './tests/e2e'` — unchanged from today.
- **Two or more categories:** `testDir: './tests'` (the parent dir) so Playwright's default recursive glob (`**/*.spec.ts`) picks up `tests/e2e/`, `tests/security/`, and `tests/perf/` together. Do not add a `testMatch` override — the default pattern already covers all three subfolders.

### 2. `tests/global-setup.ts` (only if auth or DB seed needed)

```typescript
import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  if (process.env.SKIP_GLOBAL_SETUP) return;
  // DB seed / token pre-generation goes here
}

export default globalSetup;
```

### 3. `tests/fixtures/auth.ts` (only if login required for most tests)

```typescript
import { test as base, Page } from '@playwright/test';

type AuthFixtures = { loggedInPage: Page };

export const test = base.extend<AuthFixtures>({
  loggedInPage: async ({ page }, use) => {
    await page.goto('/login');
    await page.fill('[name="email"]', process.env.TEST_EMAIL || 'test@example.com');
    await page.fill('[name="password"]', process.env.TEST_PASSWORD || 'password123');
    await page.click('[type="submit"]');
    await page.waitForURL('**/dashboard');
    await use(page);
  },
});
export { expect } from '@playwright/test';
```

Adapt selectors to match actual login form. Use `data-testid` attributes where possible.

### 4. `tests/fixtures/index.ts`

```typescript
export { test, expect } from './auth';
// export other fixtures as added
```

### 5. Spec files

#### Style rules for every spec file

```typescript
import { test, expect } from '../fixtures';  // or '@playwright/test' if no auth fixture

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/relevant-page');
  });

  test('should do the thing', async ({ page }) => {
    // Arrange
    // Act
    // Assert
    await expect(page.locator('[data-testid="thing"]')).toBeVisible();
  });
});
```

#### Selector priority (highest to lowest)
1. `data-testid` / `data-test` attributes
2. ARIA roles: `page.getByRole('button', { name: 'Submit' })`
3. Labels: `page.getByLabel('Email')`
4. Text: `page.getByText('Submit')`
5. CSS selectors (last resort — fragile)

#### DO NOT
- Use `page.waitForTimeout()` — use `expect().toBeVisible()` or `waitForURL()`
- Hard-code credentials in spec files — use `process.env.TEST_*`
- Write tests that depend on execution order
- Share state between tests — each test must be independently runnable

#### Security-smoke spec files (only if selected in Phase 2)

Write to `tests/security/*.spec.ts`. Start every security-smoke file with this header comment so it's unambiguous in review:

```typescript
// Security SMOKE checks — not a penetration test. Verifies baseline hygiene
// (headers, auth gating, reflected-input handling) on every CI run; it does
// not replace a real security assessment.
import { test, expect } from '@playwright/test';

test.describe('Security headers', () => {
  test('should set core security headers on the home page', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options'] || headers['content-security-policy']).toBeTruthy();
  });
});

test.describe('Auth bypass', () => {
  test('should redirect unauthenticated users away from a protected page', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/login/);
  });
});

test.describe('Reflected input handling', () => {
  test('should not execute a script injected via a query parameter', async ({ page }) => {
    await page.goto('/search?q=%3Cscript%3Ewindow.__xss_marker__=true%3C%2Fscript%3E');
    const executed = await page.evaluate(() => (window /** @type {any} */)['__xss_marker__']);
    expect(executed).toBeUndefined();
  });
});
```

Adapt the URLs/selectors to the actual project (a real protected route for the auth-bypass test, a real user-input-reflecting page for the injection test). If no page reflects raw query/form input anywhere, say so in the Phase 3 plan and drop that one test rather than inventing a fake target.

#### Performance-smoke spec files (only if selected in Phase 2)

Write to `tests/perf/*.spec.ts`. Uses the browser's built-in Navigation Timing API — no new dependency. Start every perf-smoke file with this header comment:

```typescript
// Performance SMOKE checks — not a load test. Asserts single-user page-load
// timing budgets on every CI run; it does not simulate concurrent traffic.
import { test, expect } from '@playwright/test';

const BUDGET_MS = 3000; // adjust to the project's actual SLA

test.describe('Page load budget', () => {
  test('should load the home page within budget', async ({ page }) => {
    await page.goto('/');
    const timing = await page.evaluate(() => {
      const [nav] = performance.getEntriesByType('navigation');
      return { domContentLoaded: nav.domContentLoadedEventEnd, loadEvent: nav.loadEventEnd };
    });
    expect(timing.domContentLoaded).toBeLessThan(BUDGET_MS);
  });
});
```

Add one `test()` per critical page from the Phase 2 "Critical flows" answer, not just the home page — reuse `BUDGET_MS` unless the user gave a different budget for a specific page.

### 6. `.env.test` (suggest, don't auto-create)

Tell user to create this file and add to `.gitignore`:
```
TEST_EMAIL=your-test-user@example.com
TEST_PASSWORD=yourpassword
```

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
      - run: npx playwright install --with-deps BROWSER_LIST
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: test-results/html-report
          retention-days: 14
```

Adapt: add `TEST_EMAIL`/`TEST_PASSWORD` (and any other `.env.test` values) as repo secrets referenced via `env:` on the `npx playwright test` step if the suite needs auth; add a `services:` block if a real backend/DB is required in CI rather than mocked. Replace `BROWSER_LIST` with the space-separated Playwright-installable engines from Phase 2's selection — `chromium`, `firefox`, `webkit`, `msedge` (Edge's underlying channel; `playwright install` accepts the channel name, not the project name `edge`). **Opera and Brave are never in `BROWSER_LIST`** — `playwright install` has no channel for either, so those projects only run against a locally-installed copy of the browser (per "Opera / Brave executable resolution" above) and should be dropped from CI, or left in with a comment noting they'll fail there unless the runner image has Opera/Brave preinstalled.

---

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
   - Test bug → correct the spec file directly (fix the selector, fix the expected value) — no confirmation needed, this only touches generated test code.
   - App bug → do NOT edit application code yet. Present the diagnosis to the user first: which file(s) you'd change, what's currently broken, and the specific fix you're proposing. Wait for the user's go-ahead before editing any application source file. Once confirmed, apply the fix and explain in your response exactly what changed and why. This confirmation step applies only to application code — never to the generated test files themselves.
   - Timing issue (a specific kind of test bug) → add a proper `expect().toBeVisible()` / `waitForURL()` wait, or a targeted timeout increase. **Never `page.waitForTimeout()`** — this project's existing DO-NOT rule (Phase 4's "Style rules" section) applies here too, including during fixes.
4. **If a failure's cause isn't clear from the error output alone,** suggest rerunning that specific test with `--trace on` (`npx playwright test <file> --trace on`) and use the resulting trace to diagnose before guessing at a fix. Don't guess-and-check blindly — use the trace.
5. **Rerun after each fix attempt** (`npx playwright test --reporter=line`, or scope to just the previously-failing files/tests for faster iteration) and document the exact command used in your response. If an app-bug fix is awaiting user confirmation (per step 3), do not rerun until that confirmation is received — a rerun without the fix applied would just reproduce the same failure and waste an attempt.
6. **After 3 attempts, if some test is still red:** stop. Do not attempt a 4th fix. Report exactly what's still failing and why (per-test, with your best diagnosis even if unresolved), and ask the user for guidance rather than continuing to iterate blindly. This matches this project's own `systematic-debugging` convention of escalating after repeated failed fix attempts.

---

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
3. Install Playwright browsers: npx playwright install BROWSER_LIST (same list as CI; skip if only Opera/Brave targets remain — those use the machine's existing install, see "Opera / Brave executable resolution")
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

---

## Quality Rules

- Every `test()` must have a clear assertion — no empty tests
- Group related tests in `test.describe()` blocks
- Use `test.fixme()` with a reason for known-broken flows (not `test.skip()`) — `fixme()` signals "this needs fixing", `skip()` signals "not applicable right now" (e.g. feature-flagged off, wrong environment)
- Keep each spec file focused on ONE feature or user journey
- Test the happy path AND one failure/validation path per flow minimum
- If a flow requires auth, use the auth fixture — don't re-login in every test
