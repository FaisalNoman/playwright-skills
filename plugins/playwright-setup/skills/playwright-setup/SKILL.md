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
| 6 | **CI/CD** | Will tests run in CI? (affects `workers`, `retries`, `forbidOnly`) |

### Optional (ask only if not inferable from code)

- DB/seed setup required before tests? (`globalSetup`)
- Test data strategy: fixtures, factories, or live DB?
- Browser targets: Chromium only, or also Firefox/Safari?
- Mobile viewports needed?
- Any existing test files to follow as style guide?
- Should Page Object Model pattern be used?

**After interview**: summarise understanding in bullet form. Ask:
> "Does this capture everything? Any gaps before I plan?"

Do not proceed until confirmed.

---

## Phase 3 — Test Plan

Present as a structured table. Show EVERY planned test — not just files.

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
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 0 : 1,
  workers: process.env.CI ? 1 : 2,
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

Adapt: remove `globalSetup` if not needed, add multiple projects if multiple baseURLs exist, fill in actual commands from package.json.

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

### 6. `.env.test` (suggest, don't auto-create)

Tell user to create this file and add to `.gitignore`:
```
TEST_EMAIL=your-test-user@example.com
TEST_PASSWORD=yourpassword
```

---

## Phase 5 — Confirm

After writing all files, report:

```
## ✓ Playwright Setup Complete

### Files created
- playwright.config.ts
- tests/e2e/auth.spec.ts         (4 tests)
- tests/e2e/booking.spec.ts      (6 tests)
- tests/fixtures/auth.ts
- tests/fixtures/index.ts
- tests/global-setup.ts

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

Also note: "Run `/e2e-dashboard` to add the real-time test progress dashboard."

---

## Quality Rules

- Every `test()` must have a clear assertion — no empty tests
- Group related tests in `test.describe()` blocks
- Use `test.fixme()` with a reason for known-broken flows (not `test.skip()`) — `fixme()` signals "this needs fixing", `skip()` signals "not applicable right now" (e.g. feature-flagged off, wrong environment)
- Keep each spec file focused on ONE feature or user journey
- Test the happy path AND one failure/validation path per flow minimum
- If a flow requires auth, use the auth fixture — don't re-login in every test
