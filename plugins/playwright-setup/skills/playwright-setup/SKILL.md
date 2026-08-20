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

## Phase 1 — Document Discovery

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
| 7 | **Browser targets** | Which browsers/device profiles to configure as Playwright projects — see "Browser Targets" below |
| 8 | **CI/CD** | Will tests run in CI? (affects `workers`, `retries`, `forbidOnly`, and whether a `.github/workflows/e2e.yml` is generated in Phase 4) |

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
- **Mobile Chrome** — `devices['Pixel 5']`.
- **Mobile Safari** — `devices['iPhone 13']`.

Selecting more than one target changes Phase 4's `playwright.config.ts` generation: each selection becomes its own `projects[]` entry, and the shared `use.launchOptions` block is replaced by a per-project window-tiling override (see Phase 4 below) — the single-Chromium case is unaffected and generates exactly what it does today.

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
    launchOptions: {
      slowMo: parseInt(process.env.PLAYWRIGHT_SLOW_MO || '0', 10),
      args: process.env.PW_WIN_X != null ? [
        `--window-position=${process.env.PW_WIN_X},${process.env.PW_WIN_Y || '0'}`,
        `--window-size=${process.env.PW_WIN_W || '960'},${process.env.PW_WIN_H || '1080'}`,
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

**Two or more targets:** generate one `projects[]` entry per selection, using the matching `devices[...]` preset, and replace the single shared `use.launchOptions` with a per-project index-based window-tiling override:

```typescript
import { defineConfig, devices } from '@playwright/test';

function windowArgsForProject(index: number) {
  if (process.env.PW_WIN_LAYOUT) {
    try {
      const layout = JSON.parse(process.env.PW_WIN_LAYOUT);
      const slot = layout[index] || layout[layout.length - 1];
      if (slot) {
        return [
          `--window-position=${slot.x},${slot.y}`,
          `--window-size=${slot.w},${slot.h}`,
          '--disable-features=CalculateNativeWinOcclusion',
        ];
      }
    } catch {}
  }
  return process.env.PW_WIN_X != null ? [
    `--window-position=${process.env.PW_WIN_X},${process.env.PW_WIN_Y || '0'}`,
    `--window-size=${process.env.PW_WIN_W || '960'},${process.env.PW_WIN_H || '1080'}`,
    '--disable-features=CalculateNativeWinOcclusion',
  ] : [];
}

export default defineConfig({
  // ...same top-level config as the single-target case (testDir, reporter, use.trace, etc.)...
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
    // one entry per selected target, index matching array position (0, 1, 2, ...)
  ],
  // ...webServer unchanged...
});
```

The mapping from Phase 2 selections to `devices[...]` presets:

| Selection | `devices[...]` preset |
|---|---|
| Chromium | `devices['Desktop Chrome']` |
| Firefox | `devices['Desktop Firefox']` |
| WebKit | `devices['Desktop Safari']` |
| Mobile Chrome | `devices['Pixel 5']` |
| Mobile Safari | `devices['iPhone 13']` |

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

---

## Phase 4.5 — Verify (mandatory, before reporting success)

Do NOT report the suite as ready without running this check.

1. Run: `npx playwright test --list`
2. **If it exits non-zero or prints a parse/syntax error:** fix the specific file it points to and re-run. Do not proceed to Phase 5 until this exits 0.
3. **If it exits 0:** note the total test count it reports and cross-check it against the plan's "# Tests" column from Phase 3 — if they don't match, investigate why (a `describe.skip`, a typo in a `test.describe` block, etc.) before reporting done.
4. Include the verified count in the Phase 5 report ("✓ N tests verified with `playwright test --list`") — this is the one concrete piece of evidence that the generated suite is actually runnable, not just plausible-looking code.

---

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

---

## Quality Rules

- Every `test()` must have a clear assertion — no empty tests
- Group related tests in `test.describe()` blocks
- Use `test.fixme()` with a reason for known-broken flows (not `test.skip()`) — `fixme()` signals "this needs fixing", `skip()` signals "not applicable right now" (e.g. feature-flagged off, wrong environment)
- Keep each spec file focused on ONE feature or user journey
- Test the happy path AND one failure/validation path per flow minimum
- If a flow requires auth, use the auth fixture — don't re-login in every test
