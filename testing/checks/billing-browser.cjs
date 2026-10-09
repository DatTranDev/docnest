/* Focused real-service billing UI check; no intercepted/mocked responses or purchases. */
const { chromium } = require('playwright');
const { readFileSync, mkdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:8080';
const root = /^MYSQL_ROOT_PASSWORD=(.*)$/m.exec(readFileSync('.env', 'utf8'))?.[1]?.trim();
assert.ok(root, 'Initialize local environment first');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', () => errors.push('browser exception'));
    const email = 'smoke-owner@editor.test';
    const password = createHash('sha256')
      .update(root + email)
      .digest('hex')
      .slice(0, 32);
    const csrf = await (await context.request.get(base + '/api/v1/auth/csrf')).json();
    const registration = await context.request.post(base + '/api/v1/auth/register', {
      headers: { Origin: base, [csrf.headerName]: csrf.token },
      data: { email, password, displayName: 'Smoke Owner' },
    });
    assert.ok([201, 409].includes(registration.status()));
    assert.equal(
      (await (await context.request.get(base + '/api/v1/billing/plans')).json()).enabled,
      false,
      'This no-purchase UI check requires Stripe disabled',
    );
    await page.goto(base);
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    const open = page.getByRole('button', { name: 'Gói dịch vụ', exact: true });
    await open.waitFor();
    let polls = 0;
    page.on('response', (response) => {
      if (response.url().endsWith('/api/v1/billing/subscription')) {
        assert.equal(response.status(), 200);
        assert.match(response.headers()['cache-control'], /no-store/);
        polls++;
      }
    });
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Gói dịch vụ' });
    await dialog.getByText('Free', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Xem giá và đăng ký' }).count(), 2);
    for (const button of await dialog.getByRole('button', { name: 'Xem giá và đăng ký' }).all())
      assert.equal(await button.isDisabled(), true);
    assert.equal(
      await dialog.getByRole('button', { name: 'Quản lý trên Stripe' }).isDisabled(),
      true,
    );
    assert.equal(
      await dialog.getByRole('button', { name: 'Đồng bộ trạng thái' }).isDisabled(),
      true,
    );
    await page.keyboard.press('Tab');
    assert.equal(
      await dialog
        .getByRole('button', { name: 'Đóng gói dịch vụ' })
        .evaluate((button) => document.activeElement === button),
      true,
    );
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await open.evaluate((button) => document.activeElement === button), true);
    const settled = polls;
    await page.waitForTimeout(3000);
    assert.equal(polls, settled, 'Closed dialog must stop polling');
    await page.setViewportSize({ width: 390, height: 844 });
    await open.click();
    await dialog.waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    mkdirSync('testing/reports/raw', { recursive: true });
    await page.screenshot({ path: 'testing/reports/raw/billing-mobile.png' });
    assert.equal(errors.length, 0);
    console.log(
      'PASS real billing UI: login, Free state, disabled Checkout/Portal, private polling, focus/escape, unmount and mobile layout. Stripe sandbox PENDING.',
    );
  } finally {
    await browser.close();
  }
})().catch(() => {
  console.error('FAIL billing UI; protected browser data withheld');
  process.exitCode = 1;
});
