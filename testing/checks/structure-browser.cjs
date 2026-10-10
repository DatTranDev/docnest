/* Real local-service acceptance: native V5 + office exports + collaborative cells. */
const { chromium } = require('playwright');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:8080';
const root = /^MYSQL_ROOT_PASSWORD=(.*)$/m.exec(readFileSync('.env', 'utf8'))?.[1]?.trim();
assert.ok(root, 'Initialize local environment first');
const report = 'testing/reports/raw';
async function login(browser, email) {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'ted-locale', value: 'en', url: base }]);
  const password = createHash('sha256')
    .update(root + email)
    .digest('hex')
    .slice(0, 32);
  const page = await context.newPage();
  await page.goto(base);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  let response = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  let authenticated = await response;
  if (authenticated.status() === 401) {
    const csrf = await (await context.request.get(base + '/api/v1/auth/csrf')).json();
    const registered = await context.request.post(base + '/api/v1/auth/register', {
      headers: { Origin: base, [csrf.headerName]: csrf.token },
      data: { email, password, displayName: 'Structure acceptance' },
    });
    if (![201, 409].includes(registered.status()))
      console.error(`Unexpected registration HTTP status: ${registered.status()}`);
    assert.ok([201, 409].includes(registered.status()), 'Registration status');
    await page.reload();
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
    response = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    authenticated = await response;
  }
  if (authenticated.status() !== 200)
    console.error(`Unexpected login HTTP status: ${authenticated.status()}`);
  assert.equal(authenticated.status(), 200, 'Login status');
  const session = await authenticated.json();
  await page.getByRole('button', { name: 'New', exact: true }).waitFor();
  return { context, page, token: session.accessToken, user: session.user };
}
async function api(user, path, method = 'GET', data, expected = 200) {
  const response = await user.context.request.fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${user.token}`, 'Idempotency-Key': randomUUID() },
    ...(data === undefined ? {} : { data }),
  });
  if (response.status() !== expected)
    console.error(`Unexpected ${method} API status: ${response.status()} (expected ${expected})`);
  assert.equal(response.status(), expected, `${method} API status`);
  return expected === 204 ? undefined : response.json();
}
async function insertMenu(page, label) {
  const details = page
    .locator('.tool-menu')
    .filter({ has: page.locator('summary', { hasText: /^Insert content$/ }) });
  if (!(await details.evaluate((node) => node.open))) await details.locator('summary').click();
  await details.getByRole('button', { name: label, exact: true }).click();
}
async function fillCell(page, index, text) {
  const cell = page.locator('.editor-table td[data-cell]').nth(index);
  await cell.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
  await page.waitForFunction(
    ([index, value]) =>
      document.querySelectorAll('.editor-table td[data-cell]')[index]?.textContent === value,
    [index, text],
  );
}
async function save(user) {
  await user.page.getByRole('button', { name: 'Save', exact: true }).click();
  await user.page.getByText('Saved', { exact: true }).waitFor({ timeout: 30000 });
}
async function waitCells(page, first, second) {
  await page.waitForFunction(
    ([a, b]) => {
      const cells = [...document.querySelectorAll('.editor-table td[data-cell]')];
      return cells[0]?.textContent === a && cells[1]?.textContent === b;
    },
    [first, second],
  );
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  let owner, documentId;
  let stage = 'login';
  try {
    mkdirSync(report, { recursive: true });
    owner = await login(browser, 'smoke-owner@editor.test');
    const guest = await login(browser, 'smoke-recipient@editor.test');
    const { page } = owner;
    const errors = [];
    page.on('pageerror', (error) =>
      errors.push({
        name: error.name,
        frame:
          /_next\/static\/chunks\/[A-Za-z0-9_.-]+\.js:\d+:\d+/.exec(error.stack ?? '')?.[0] ??
          'unknown',
        kind:
          error.message ===
          'Calls to EditorView.update are not allowed while an update is in progress'
            ? 'CM_REENTRANT'
            : error.message ===
                "Trying to update state with a transaction that doesn't start from the previous state."
              ? 'CM_STALE_STATE'
              : 'unclassified',
      }),
    );
    stage = 'create document';
    const title = `Structure acceptance ${Date.now()}`;
    const created = await api(owner, '/api/v1/documents', 'POST', { title, folderId: null }, 201);
    documentId = created.id;
    await page.reload();
    await page.getByRole('button', { name: title, exact: true }).last().click();
    stage = 'paragraphs and hyperlink';
    await page.locator('.cm-content').click();
    await page.keyboard.insertText('First Việt\nSecond\n');
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByRole('button', { name: 'Numbered list', exact: true }).click();
    await page.getByRole('button', { name: 'Increase indent', exact: true }).click();
    await page.getByRole('combobox', { name: 'Line spacing', exact: true }).selectOption('2');
    await page
      .getByRole('combobox', { name: 'Spacing after paragraph', exact: true })
      .selectOption('12');
    assert.equal(await page.locator('.cm-line[data-marker="2."]').count(), 1);
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('Shift+End');
    await insertMenu(page, 'Hyperlink');
    await page
      .getByRole('textbox', { name: 'Link address', exact: true })
      .fill('https://example.com/?a=1&b=2');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    assert.ok(await page.locator('a.editor-link').count());
    stage = 'page settings';
    await insertMenu(page, 'Header and footer');
    await page.getByRole('textbox', { name: 'Header', exact: true }).fill('Header Việt');
    await page.getByRole('textbox', { name: 'Footer', exact: true }).fill('Footer Việt');
    await page.getByRole('checkbox', { name: 'Page numbers', exact: true }).check();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    stage = 'editable table';
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertMenu(page, 'Insert table');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    assert.equal(await page.locator('.editor-table td[data-cell]').count(), 4);
    assert.ok(
      (await page.locator('.editor-table').boundingBox()).width < 900,
      'Table stays inside editor width',
    );
    for (const [i, text] of ['Cell Việt', 'Cell two', 'Cell three', 'Cell four'].entries())
      await fillCell(page, i, text);
    stage = 'bold table cell';
    await page.locator('.editor-table td[data-cell]').first().click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+b');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.editor-table td:first-child span')].some(
        (node) => getComputedStyle(node).fontWeight === '700',
      ),
    );
    await page.keyboard.press('ControlOrMeta+b');
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.editor-table td:first-child span')].some(
        (node) => getComputedStyle(node).fontWeight === '700',
      ),
    );
    stage = 'stored page break';
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertMenu(page, 'Insert page break');
    await page.keyboard.insertText('Next page');
    assert.ok(await page.locator('.editor-page-break').count());
    stage = 'native save/reopen';
    await save(owner);
    await page.reload();
    await page.getByRole('button', { name: title, exact: true }).last().click();
    await waitCells(page, 'Cell Việt', 'Cell two');
    assert.ok(await page.locator('a.editor-link').count());
    const before = await api(owner, `/api/v1/documents/${documentId}`);
    stage = 'A4';
    await page.getByRole('button', { name: 'A4 page preview', exact: true }).click();
    await page.locator('.page-preview-table td').first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.page-preview-sheet').length >= 2);
    assert.equal(
      await page.locator('.page-preview-sheet header').first().textContent(),
      'Header Việt',
    );
    await page.screenshot({ path: `${report}/structure-desktop.png`, fullPage: true });
    await page.getByRole('button', { name: 'Back to editing', exact: true }).click();
    stage = 'actual Kafka office exports';
    for (const type of ['EXPORT_DOCX', 'EXPORT_PDF', 'EXPORT_HTML']) {
      const job = await api(
        owner,
        '/api/v1/jobs',
        'POST',
        { documentId, revision: before.headRevision, type },
        202,
      );
      const until = Date.now() + 60000;
      let current;
      do {
        current = await api(owner, `/api/v1/jobs/${job.id}`);
        if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(current.state)) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      } while (Date.now() < until);
      if (current.state !== 'SUCCEEDED')
        console.error(JSON.stringify({ exportType: type, state: current.state }));
      assert.equal(current.state, 'SUCCEEDED', `${type} completed`);
      const result = await owner.context.request.get(base + `/api/v1/jobs/${job.id}/content`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      assert.equal(result.status(), 200);
      const data = await result.body();
      const extension = { EXPORT_DOCX: 'docx', EXPORT_PDF: 'pdf', EXPORT_HTML: 'html' }[type];
      assert.equal(data.length, Number(result.headers()['content-length']));
      writeFileSync(`${report}/structure-browser.${extension}`, data);
      if (type === 'EXPORT_DOCX') {
        assert.equal(data.subarray(0, 2).toString(), 'PK');
        assert.match(result.headers()['content-type'], /wordprocessingml/);
      }
      if (type === 'EXPORT_PDF') {
        assert.equal(data.subarray(0, 5).toString(), '%PDF-');
        assert.match(result.headers()['content-type'], /application\/pdf/);
      }
      if (type === 'EXPORT_HTML') {
        const html = data.toString();
        assert.match(html, /<table/);
        assert.match(html, /Cell Việt/);
        assert.match(html, /Header Việt/);
        assert.match(html, /href="https:\/\/example.com/);
      }
    }
    stage = 'two-user concurrent table edits';
    await api(owner, `/api/v1/documents/${documentId}/permissions`, 'POST', {
      email: 'smoke-recipient@editor.test',
      role: 'EDITOR',
    });
    await guest.page.reload();
    await guest.page.getByRole('button', { name: 'Shared with me', exact: true }).click();
    await guest.page.getByRole('button', { name: title, exact: true }).last().click();
    for (const user of [owner, guest]) {
      await user.page.getByRole('button', { name: 'Edit together', exact: true }).click();
      await user.page
        .getByRole('button', { name: 'Collaboration synced', exact: true })
        .waitFor({ timeout: 30000 });
    }
    await owner.context.setOffline(true);
    await guest.context.setOffline(true);
    await fillCell(owner.page, 0, 'Owner Việt');
    await fillCell(guest.page, 1, 'Guest Việt');
    await owner.context.setOffline(false);
    await guest.context.setOffline(false);
    await waitCells(owner.page, 'Owner Việt', 'Guest Việt');
    await waitCells(guest.page, 'Owner Việt', 'Guest Việt');
    await save(owner);
    await owner.page.reload();
    await owner.page.getByRole('button', { name: title, exact: true }).last().click();
    await waitCells(owner.page, 'Owner Việt', 'Guest Việt');
    stage = 'read-only public table';
    const share = await api(
      owner,
      `/api/v1/documents/${documentId}/share-links`,
      'POST',
      {
        expiresInSeconds: 3600,
      },
      201,
    );
    const publicPage = await guest.context.newPage();
    await publicPage.goto(base + share.viewerPath);
    await publicPage.locator('.editor-table td[data-cell]').first().waitFor();
    const publicCell = publicPage.locator('.editor-table td[data-cell]').first();
    const beforePaste = await publicCell.textContent();
    await publicCell.evaluate((cell) => {
      const data = new DataTransfer();
      data.setData('text/plain', 'Blocked paste');
      cell.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
      );
    });
    assert.equal(await publicCell.textContent(), beforePaste, 'Public table ignores paste');
    console.log(
      JSON.stringify({
        publicEditable: await publicPage
          .locator('.editor-table td[data-cell]')
          .first()
          .getAttribute('contenteditable'),
        parentEditable: await publicPage.locator('.cm-content').getAttribute('contenteditable'),
        errors,
      }),
    );
    assert.equal(
      await publicPage
        .locator('.editor-table td[data-cell]')
        .first()
        .getAttribute('contenteditable'),
      'false',
    );
    console.log(
      JSON.stringify({
        browserErrors: errors.length,
        publicEditable: await publicPage
          .locator('.editor-table td[data-cell]')
          .first()
          .getAttribute('contenteditable'),
      }),
    );
    assert.equal(errors.length, 0);
    console.log(
      'PASS: V5 paragraphs/link/table/page settings, save/reopen, A4, real Kafka DOCX/PDF/HTML, offline concurrent cells and read-only public viewing',
    );
  } catch (error) {
    if (owner)
      console.error(
        JSON.stringify(
          await owner.page.evaluate(() => ({
            cells: [...document.querySelectorAll('.editor-table td')].map((n) => ({
              length: n.textContent.length,
              spans: n.querySelectorAll('span').length,
              color: getComputedStyle(n).color,
              width: n.getBoundingClientRect().width,
            })),
            lines: [...document.querySelectorAll('.cm-line')].map((n) => ({
              length: n.textContent.length,
              color: getComputedStyle(n).color,
            })),
            active: document.activeElement.tagName,
          })),
        ),
      );
    if (owner)
      await owner.page.screenshot({ path: `${report}/structure-failure.png`, fullPage: true });
    console.error(`FAIL structure stage: ${stage}; ${error.name}`);
    process.exitCode = 1;
  } finally {
    if (owner && documentId) {
      const current = await api(owner, `/api/v1/documents/${documentId}`);
      await api(
        owner,
        `/api/v1/documents/${documentId}`,
        'DELETE',
        { expectedMetadataRevision: current.metadataRevision },
        204,
      );
    }
    await browser.close();
  }
})();
