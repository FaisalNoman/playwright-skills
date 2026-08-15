// plugins/e2e-dashboard/tests/fixtures/security-example.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Security smoke', () => {
  test('should pass', async () => {
    expect(1 + 1).toBe(2);
  });
});
