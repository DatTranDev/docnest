/* Focused bilingual UI gate against the running application; no intercepted responses. */
const { chromium } = require('playwright');
const { readFileSync, mkdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:8080';
const root = /^MYSQL_ROOT_PASSWORD=(.*)$/m.exec(readFileSync('.env', 'utf8'))?.[1]?.trim();
assert.ok(root, 'Initialize the local environment first');
async function waitText(page, value) {
  await page.waitForFunction(
    (expected) => document.querySelector('.cm-content')?.textContent === expected,
    value,
  );
}
async function api(context, token, path, method = 'GET', data, status = 200) {
  const response = await context.request.fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(data === undefined ? {} : { data }),
  });
  assert.equal(response.status(), status, 'Authenticated API status');
  return status === 204 ? null : response.json();
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  let token, documentId, context;
  let stage = 'startup';
  try {
    context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', () => errors.push('browser exception'));
    await page.addInitScript(() => {
      window.__workerCount = 0;
      const Worker = window.Worker;
      window.Worker = class extends Worker {
        constructor(...args) {
          super(...args);
          window.__workerCount++;
        }
      };
    });
    const email = process.env.SMOKE_OWNER_EMAIL || 'smoke-owner@editor.test';
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
    stage = 'language preference and login errors';
    await page.goto(base);
    await page.getByRole('combobox', { name: 'Ngôn ngữ' }).selectOption('en');
    await page.getByRole('textbox', { name: 'Password' }).fill('incorrect-password');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('alert').getByText('Incorrect email or password.').waitFor();
    await page.getByRole('combobox', { name: 'Language' }).selectOption('vi');
    await page.getByRole('alert').getByText('Email hoặc mật khẩu không đúng.').waitFor();
    await page.getByRole('combobox', { name: 'Ngôn ngữ' }).selectOption('en');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.match(await page.title(), /docsnest/);
    const html = await (await context.request.get(base)).text();
    assert.match(html, /<html lang="en"/);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    const login = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    token = (await (await login).json()).accessToken;
    await page.getByRole('button', { name: 'New', exact: true }).waitFor();
    stage = 'localized document prompt';
    const title = `i18n check ${Date.now()}`;
    page.once('dialog', async (dialog) => {
      assert.equal(dialog.message(), 'Document name');
      assert.equal(dialog.defaultValue(), 'New document');
      await dialog.accept(title);
    });
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/documents') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New document', exact: true }).click();
    documentId = (await (await created).json()).id;
    await page.locator('.cm-content').waitFor();
    const text = 'Hello Việt Nam 😀';
    await page.locator('.cm-content').click();
    await page.keyboard.insertText(text);
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await page.getByRole('combobox', { name: 'Font', exact: true }).selectOption('Georgia');
    await page.getByRole('combobox', { name: 'Font size', exact: true }).selectOption('16');
    await page.getByRole('combobox', { name: 'Text style', exact: true }).selectOption('heading2');
    await page.getByRole('button', { name: 'Increase font size', exact: true }).click();
    assert.equal(
      await page.getByRole('combobox', { name: 'Font size', exact: true }).inputValue(),
      '17',
    );
    await page.getByRole('button', { name: 'Decrease font size', exact: true }).click();
    await page.getByRole('button', { name: 'Highlight text', exact: true }).click();
    await page.getByRole('button', { name: 'Strikethrough', exact: true }).click();
    await page.getByRole('button', { name: 'Superscript', exact: true }).click();
    await page.getByRole('button', { name: 'Subscript', exact: true }).click();
    assert.equal(
      await page
        .getByRole('button', { name: 'Superscript', exact: true })
        .getAttribute('aria-pressed'),
      'false',
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Subscript', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.getByRole('button', { name: 'Align center', exact: true }).click();
    stage = 'unsaved offline locale change preserves editor and history';
    await context.setOffline(true);
    await page.evaluate(() => {
      window.__editorNode = document.querySelector('.cm-content');
      window.__initialWorkers = window.__workerCount;
    });
    await page.getByRole('combobox', { name: 'Language' }).selectOption('vi');
    await page.getByRole('status').getByText('Ngoại tuyến', { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.__editorNode === document.querySelector('.cm-content') &&
          window.__initialWorkers === window.__workerCount,
      ),
      true,
    );
    await waitText(page, text);
    assert.equal(
      await page
        .getByRole('button', { name: 'Căn giữa', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
    assert.equal(
      await page
        .getByRole('button', { name: 'Căn trái', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.getByRole('button', { name: 'Làm lại', exact: true }).click();
    assert.equal(
      await page
        .getByRole('button', { name: 'Căn giữa', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await context.setOffline(false);
    await page.getByRole('combobox', { name: 'Ngôn ngữ' }).selectOption('en');
    stage = 'search results and replacement survive locale changes';
    await page.getByRole('button', { name: 'Find & replace', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search', exact: true }).fill('Hello');
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await page.locator('.search-count').getByText('1 match', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Language' }).selectOption('vi');
    await page.locator('.search-count').getByText('1 kết quả', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Thay thế', exact: true }).fill('Welcome');
    await page.getByRole('button', { name: 'Thay tất cả', exact: true }).click();
    await waitText(page, text.replace('Hello', 'Welcome'));
    await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
    await waitText(page, text);
    await page.getByRole('button', { name: 'Đóng tìm kiếm', exact: true }).click();
    await page.getByRole('combobox', { name: 'Ngôn ngữ' }).selectOption('en');
    stage = 'image labels and Blob URLs';
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      'base64',
    );
    await page
      .getByLabel('Choose a PNG or JPEG image')
      .setInputFiles({ name: 'localization.png', mimeType: 'image/png', buffer: png });
    const image = page.getByAltText('Image in document');
    await image.waitFor();
    const url = await image.getAttribute('src');
    await page.getByRole('combobox', { name: 'Language' }).selectOption('vi');
    assert.equal(await page.getByAltText('Ảnh trong tài liệu').getAttribute('src'), url);
    await page.getByRole('combobox', { name: 'Ngôn ngữ' }).selectOption('en');
    stage = 'save reopen and localized dialogs';
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('.save-status').getByText('Saved', { exact: true }).waitFor();
    mkdirSync('testing/reports/raw', { recursive: true });
    await page.screenshot({ path: 'testing/reports/raw/formats-desktop.png' });
    stage = 'real export job labels and download';
    await page.locator('.tool-menu:last-of-type > summary').click();
    await page.getByRole('button', { name: 'Export TXT on server', exact: true }).click();
    await page.getByRole('button', { name: 'Download result', exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Language' }).selectOption('vi');
    await page.getByRole('button', { name: 'Tải kết quả', exact: true }).waitFor();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Tải kết quả', exact: true }).click();
    const output = await downloaded;
    assert.equal(readFileSync(await output.path(), 'utf8'), text + '[Image]');
    await page.getByRole('combobox', { name: 'Ngôn ngữ' }).selectOption('en');
    await page.locator('.tool-menu:last-of-type > summary').click();
    await page.getByRole('button', { name: 'Export HTML on server', exact: true }).click();
    const htmlButtons = page.getByRole('button', { name: 'Download result', exact: true });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].filter(
          (button) => button.textContent.trim() === 'Download result',
        ).length === 2,
    );
    const htmlDownload = page.waitForEvent('download');
    await htmlButtons.first().click();
    const htmlFile = await htmlDownload;
    const exportedHtml = readFileSync(await htmlFile.path(), 'utf8');
    assert.match(exportedHtml, /background-color:#ffff00/);
    assert.match(exportedHtml, /text-decoration-line:line-through/);
    assert.match(exportedHtml, /vertical-align:super/);
    assert.match(exportedHtml, /Hello Việt Nam/);
    stage = 'history and page preview';
    await page.getByRole('button', { name: 'Version', exact: true }).click();
    const history = page.getByRole('dialog', { name: 'Version history' });
    await history.getByRole('button', { name: 'Open read only' }).first().waitFor();
    await history.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'A4 page preview' }).click();
    await page
      .getByRole('dialog', { name: 'A4 page preview' })
      .getByText('1 page', { exact: true })
      .waitFor();
    await page.getByRole('button', { name: 'Back to editing' }).click();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const sharing = page.getByRole('dialog', { name: 'Share', exact: true });
    await sharing.getByRole('button', { name: 'Create a 7-day link' }).click();
    const link = await sharing
      .getByRole('textbox', { name: 'Public link', exact: true })
      .inputValue();
    await sharing.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: title, exact: true }).last().click();
    await page.getByAltText('Image in document').waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.cm-line span')].some(
        (span) =>
          getComputedStyle(span).fontFamily.includes('Arial') &&
          Number(getComputedStyle(span).fontWeight) >= 700,
      ),
    );
    assert.equal(await page.locator('.cm-content').getAttribute('aria-label'), 'Text editor');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.cm-line span')].some((span) => {
        const css = getComputedStyle(span);
        return (
          css.backgroundColor === 'rgb(255, 255, 0)' &&
          css.textDecorationLine.includes('line-through') &&
          css.verticalAlign === 'super'
        );
      }),
    );
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByRole('button', { name: 'Clear formatting', exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.cm-line span')].some(
        (span) => getComputedStyle(span).backgroundColor === 'rgb(255, 255, 0)',
      ),
    );
    await page.locator('.save-status').getByText('Saved', { exact: true }).waitFor();
    stage = 'public view and billing mobile';
    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto(link);
    await publicPage.getByAltText('Ảnh trong tài liệu').waitFor();
    await publicPage.getByRole('combobox', { name: 'Ngôn ngữ' }).selectOption('en');
    await publicPage.getByAltText('Image in document').waitFor();
    assert.equal(await publicPage.locator('.cm-content').getAttribute('contenteditable'), 'false');
    await publicPage.getByRole('button', { name: 'Download TXT' }).waitFor();
    await publicContext.close();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: /^Account for / }).click();
    await page.getByRole('menuitem', { name: 'Subscription plans', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Subscription plans' })
      .getByText('Free', { exact: true })
      .waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.getByRole('button', { name: 'Close subscription plans' }).click();
    assert.equal(errors.length, 0);
    console.log(
      'PASS bilingual formatting: locale/errors/offline/history, presets/font steps, highlight/strike/super/subscript, clear/undo/Saved, V4 native save/reopen, real TXT/HTML exports, history/A4/share/public labels, unchanged Blob URLs and mobile.',
    );
  } catch (error) {
    console.error(`FAIL i18n at ${stage}; protected browser data withheld (${error.name})`);
    process.exitCode = 1;
  } finally {
    if (token && documentId) {
      try {
        const document = await api(context, token, `/api/v1/documents/${documentId}`);
        await api(
          context,
          token,
          `/api/v1/documents/${documentId}`,
          'DELETE',
          { expectedMetadataRevision: document.metadataRevision },
          204,
        );
      } catch {
        console.error('FAIL cleanup of the disposable i18n document');
        process.exitCode = 1;
      }
    }
    await browser.close();
  }
})();
