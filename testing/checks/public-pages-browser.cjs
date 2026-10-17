/* Real local gateway/Identity acceptance; no API mocks or external accounts. */
const { chromium, expect } = require('@playwright/test');
const { createHash } = require('node:crypto');
const { readFileSync, mkdirSync } = require('node:fs');
const assert = require('node:assert/strict');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:8080';
const reports = 'testing/reports/raw';

async function main() {
  mkdirSync(reports, { recursive: true });
  const rootSecret = /^MYSQL_ROOT_PASSWORD=(.*)$/m
    .exec(readFileSync(require('./browser-environment.cjs').environmentFile, 'utf8'))?.[1]
    ?.trim();
  assert.ok(rootSecret, 'Initialize the local environment first');
  const email = 'public-ui-acceptance@editor.test';
  const password = createHash('sha256')
    .update(rootSecret + email)
    .digest('hex')
    .slice(0, 24);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.name));
  let stage = 'landing';
  async function noOverflow() {
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Page must not overflow horizontally',
    );
  }
  async function capture(name) {
    await page.screenshot({ path: `${reports}/public-ui-${name}.png`, fullPage: false });
    await noOverflow();
  }
  try {
    await expect
      .poll(async () => (await context.request.get(base + '/healthz')).status(), {
        timeout: 30_000,
      })
      .toBe(200);
    await context.addCookies([{ name: 'ted-locale', value: 'en', url: base }]);
    let localApiRequests = 0;
    const countApi = (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) localApiRequests++;
    };
    page.on('request', countApi);
    await page.goto(base + '/intro');
    await expect(page.locator('.intro-demo')).toBeVisible();
    await expect(page.locator('.intro-feature-list a')).toHaveCount(4);
    await page.evaluate(() => document.fonts.ready);
    await capture('landing-desktop');
    await page.locator('.intro-feature-list a').last().click();
    await expect(page.getByRole('tab', { name: 'JSON', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    assert.equal(localApiRequests, 0, 'Landing and local editor must not call authenticated APIs');
    page.off('request', countApi);

    stage = 'login';
    await page.goto(base);
    await expect(page.locator('.auth-mode')).toBeVisible();
    await capture('login-desktop');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Show password', exact: true }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Hide password', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Create a new account', exact: true }).click();
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email);
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
    await expect(page.locator('.auth h1')).toBeFocused();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    await page.getByLabel('Email', { exact: true }).clear();
    await page.getByLabel('Password', { exact: true }).clear();
    await capture('signup-desktop');
    await page.setViewportSize({ width: 375, height: 812 });
    await capture('signup-mobile');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.locator('[name=displayName]')).toBeFocused();
    await expect(page.locator('#auth-name-error')).toBeVisible();
    await page.getByLabel('Display name', { exact: true }).fill('Public UI Acceptance');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.locator('#auth-password-error')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();

    stage = 'real registration';
    await page.getByLabel('Password', { exact: true }).fill(password);
    const registration = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/auth/register') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    const status = (await registration).status();
    assert.ok(
      [201, 409].includes(status),
      'Registration must succeed or find the dedicated fixture',
    );
    if (status === 409) {
      await expect(page.locator('.auth-form-error')).toBeFocused();
      await page.locator('.auth-mode button').first().click();
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    }
    await expect(page.locator('.auth')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Account for Public UI Acceptance' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Account for Public UI Acceptance' }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('.auth-mode')).toBeVisible();

    stage = 'real login error';
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password + '-wrong');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.auth-form-error')).toBeFocused();
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email);
    await page.getByLabel('Email', { exact: true }).clear();
    await page.getByLabel('Password', { exact: true }).clear();
    await page.locator('.auth .language-selector-trigger').click();
    await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click();
    await capture('login-mobile-vi');

    stage = 'themes and responsive layouts';
    await page.goto(base + '/intro');
    await page.evaluate(() => {
      localStorage.setItem('docsnest:local-theme', 'dark');
      window.dispatchEvent(new Event('docsnest:local-theme'));
    });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await capture('landing-mobile-dark-vi');
    await page.setViewportSize({ width: 812, height: 375 });
    await noOverflow();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await capture('landing-desktop-dark-vi');
    await page.locator('.site-login').click();
    await expect(page.locator('.auth-mode')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await capture('login-desktop-dark-vi');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: 'Tạo tài khoản mới', exact: true }).click();
    await capture('signup-mobile-dark-vi');
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log(
      'PASS real registration/login/logout, validation/focus, password visibility, locale, theme, reduced motion, responsive layouts and local API isolation',
    );
  } catch (error) {
    // Capture no field contents or request payloads on failure.
    const line = /public-pages-browser\.cjs:(\d+)/.exec(error.stack)?.[1] || 'unknown';
    console.error(`FAIL public UI browser stage: ${stage} (${error.name}, test line ${line})`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
void main();
