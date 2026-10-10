/* Real services: account settings, native select UI, DOCX import/save and DOCX/PDF jobs. */
const { chromium } = require('playwright');
const { zipSync, unzipSync, strToU8 } = require('fflate');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:8080';
const root = /^MYSQL_ROOT_PASSWORD=(.*)$/m.exec(readFileSync('.env', 'utf8'))?.[1]?.trim();
assert.ok(root, 'Initialize the local environment first');
const report = 'testing/reports/raw';
const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fixture = (body) =>
  zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${word}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}</w:body></w:document>`,
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${word}"><w:style w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:styleId="Heading1"><w:basedOn w:val="Normal"/><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style></w:styles>`,
    ),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${word}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="42"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    ),
    'word/_rels/document.xml.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Target="media/image.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/><Relationship Id="link1" Target="https://example.com/" TargetMode="External" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"/><Relationship Id="footer1" Target="footer1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer"/></Relationships>',
    ),
    'word/footer1.xml': strToU8(
      `<w:ftr xmlns:w="${word}"><w:p><w:r><w:t>docsnest Việt</w:t></w:r><w:fldSimple w:instr="PAGE"/></w:p></w:ftr>`,
    ),
    'word/media/image.png': Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
        'base64',
      ),
    ),
  });
const p = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const sample =
  fixture(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Kế hoạch viết cùng docsnest</w:t></w:r></w:p>
  <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:i/><w:u/><w:color w:val="1A73E8"/><w:shd w:fill="FFFF00"/><w:strike/></w:rPr><w:t>Tiếng Việt 👋 — giữ định dạng</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="42"/></w:numPr></w:pPr><w:r><w:t>Viết mỗi ngày</w:t></w:r></w:p>
  <w:p><w:hyperlink r:id="link1"><w:r><w:t>Tham khảo</w:t></w:r></w:hyperlink></w:p>
  <w:tbl><w:tr><w:tc>${p('Mục tiêu')}</w:tc><w:tc>${p('Tiến độ')}</w:tc></w:tr><w:tr><w:tc>${p('Bản thảo')}</w:tc><w:tc>${p('')}</w:tc></w:tr></w:tbl>
  <w:p><w:r><w:drawing><wp:inline><a:blip r:embed="image1"/></wp:inline></w:drawing></w:r></w:p>
  <w:sectPr><w:footerReference w:type="default" r:id="footer1"/></w:sectPr>`);
const unsupported = fixture(
  `<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p('Merged')}</w:tc></w:tr></w:tbl>`,
);
async function login(page, email, vi = false) {
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByRole('textbox', { name: vi ? 'Mật khẩu' : 'Password', exact: true }).fill(
    createHash('sha256')
      .update(root + email)
      .digest('hex')
      .slice(0, 32),
  );
  const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button', { name: vi ? 'Đăng nhập' : 'Sign in', exact: true }).click();
  const result = await response;
  assert.equal(result.status(), 200, 'Fixture login');
  return result.json();
}
async function accountMenu(page, vi = false) {
  await page.locator('.account-menu .action-menu-trigger').click();
  await page.getByRole('menuitem', { name: vi ? 'Cài đặt' : 'Settings', exact: true }).waitFor();
}
async function settings(page, vi = false) {
  await accountMenu(page, vi);
  await page.getByRole('menuitem', { name: vi ? 'Cài đặt' : 'Settings', exact: true }).click();
  return page.getByRole('dialog', { name: vi ? 'Cài đặt' : 'Settings', exact: true });
}
async function api(context, token, path, method = 'GET', data, expected = 200) {
  const response = await context.request.fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(data ? { data } : {}),
  });
  assert.equal(response.status(), expected, 'Fixture API status');
  return expected === 204 ? null : response.json();
}
async function selectFile(page, data, name = 'sample.docx', replace = false) {
  const input = page.locator(
    replace
      ? '.editor-section input[type=file][accept*="docx"]'
      : '.sidebar input[type=file][accept*="docx"]',
  );
  await input.setInputFiles({
    name,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(data),
  });
}
async function theme(page, value) {
  await page.waitForFunction(
    (expected) => document.documentElement.dataset.theme === expected,
    value,
  );
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    colorScheme: 'light',
  });
  await context.addCookies([{ name: 'ted-locale', value: 'en', url: base }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', () => errors.push('Browser exception'));
  let stage = 'login',
    owner,
    documentId;
  try {
    mkdirSync(report, { recursive: true });
    await page.goto(base);
    owner = await login(page, 'smoke-recipient@editor.test');
    await page.getByRole('button', { name: 'New', exact: true }).waitFor();
    assert.equal(await page.title(), 'docsnest');
    stage = 'native dropdown visual and keyboard';
    assert.equal(await page.evaluate(() => CSS.supports('appearance', 'base-select')), true);
    const filter = page.getByRole('combobox', { name: 'Type', exact: true });
    await filter.click();
    await page.screenshot({ path: `${report}/docsnest-dropdown.png` });
    await page.keyboard.press('Escape');
    await filter.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await filter.inputValue(), 'folders');
    await filter.selectOption('all');
    stage = 'import DOCX through New menu';
    await page.getByRole('button', { name: 'Shared with me', exact: true }).click();
    const title = `docsnest acceptance ${Date.now()}`;
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Import a local file', exact: true }).click();
    const fileChooser = await chooser;
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/documents') && r.request().method() === 'POST',
    );
    page.once('dialog', (dialog) => dialog.accept(title));
    await fileChooser.setFiles({
      name: 'Writing plan.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(sample),
    });
    const creation = await created;
    assert.equal(creation.status(), 201, 'Imported document creation');
    documentId = (await creation.json()).id;
    assert.equal(
      await page
        .getByRole('button', { name: 'My documents', exact: true })
        .getAttribute('aria-current'),
      'page',
      'Import returns to the owner library',
    );
    await page
      .locator('.cm-content')
      .getByText('Kế hoạch viết cùng docsnest', { exact: true })
      .waitFor();
    assert.equal(await page.locator('.editor-table td[data-cell]').count(), 4);
    assert.equal(await page.locator('.editor-inline-image').count(), 1);
    assert.ok(await page.locator('.cm-content .style-7').count(), 'Bold italic underline imported');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page
      .locator('.save-status')
      .getByText('Saved', { exact: true })
      .waitFor({ timeout: 30000 });
    const saved = await api(context, owner.accessToken, `/api/v1/documents/${documentId}`);
    const nativeResponse = await context.request.get(
      `${base}/api/v1/documents/${documentId}/versions/${saved.headRevision}/content`,
      { headers: { Authorization: `Bearer ${owner.accessToken}` } },
    );
    assert.equal(nativeResponse.status(), 200);
    const parts = unzipSync(await nativeResponse.body());
    assert.match(Buffer.from(parts['text.utf8']).toString(), /Tiếng Việt 👋/);
    const formatting = JSON.parse(Buffer.from(parts['formatting.json']).toString());
    assert.ok(
      formatting.runs.some(
        (run) =>
          run.color?.toLowerCase() === '#1a73e8' &&
          run.background?.toLowerCase() === '#ffff00' &&
          run.strike,
      ),
    );
    assert.ok(formatting.runs.some((run) => run.link === 'https://example.com/'));
    assert.ok(formatting.paragraphs.some((paragraph) => paragraph.list === 'bullet'));
    assert.equal(formatting.page.footer, 'docsnest Việt');
    assert.equal(formatting.page.pageNumbers, true);
    assert.equal(JSON.parse(Buffer.from(parts['media.json']).toString()).images.length, 1);
    stage = 'failed or cancelled imports retain current contents';
    const editor = await page.locator('.cm-content').elementHandle();
    await selectFile(page, unsupported, 'unsupported.docx', true);
    await page
      .getByRole('alert')
      .getByText(
        'This Word file contains structures that docsnest cannot safely import yet. The current document has not changed.',
      )
      .waitFor();
    assert.equal(
      await editor.evaluate((node) => node === document.querySelector('.cm-content')),
      true,
    );
    await selectFile(page, Buffer.from('not a Word file'), 'invalid.docx', true);
    await page.getByRole('alert').getByText('Choose a valid DOCX document.').waitFor();
    assert.equal(
      await editor.evaluate((node) => node === document.querySelector('.cm-content')),
      true,
    );
    const cancelled = page.waitForEvent('dialog');
    await selectFile(page, sample, 'cancelled.docx', true);
    await (await cancelled).dismiss();
    assert.equal(
      await editor.evaluate((node) => node === document.querySelector('.cm-content')),
      true,
    );
    stage = 'real DOCX and PDF jobs from File menu';
    for (const type of ['DOCX', 'PDF']) {
      const menu = page
        .locator('.tool-menu')
        .filter({ has: page.locator('summary', { hasText: 'File' }) });
      if (!(await menu.evaluate((node) => node.open))) await menu.locator('summary').click();
      const requested = page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/jobs') && r.request().method() === 'POST',
        { timeout: 45000 },
      );
      requested.catch(() => {});
      await page.screenshot({ path: `${report}/docsnest-file-menu.png` });
      await page
        .getByRole('button', { name: `Export ${type}`, exact: true })
        .click({ timeout: 10000 });
      const response = await requested;
      assert.equal(response.status(), 202);
      const job = await response.json();
      await page.waitForFunction(
        async ([url, token, id]) => {
          const response = await fetch(`${url}/api/v1/jobs/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          return response.ok && (await response.json()).state === 'SUCCEEDED';
        },
        [base, owner.accessToken, job.id],
        { timeout: 60000 },
      );
      const download = page.waitForEvent('download');
      await page
        .locator('.row')
        .filter({ hasText: `Export ${type}` })
        .getByRole('button', { name: 'Download result', exact: true })
        .click();
      const output = await download;
      const path = `${report}/docsnest-import-export.${type.toLowerCase()}`;
      await output.saveAs(path);
      const bytes = readFileSync(path);
      assert.equal(
        bytes.subarray(0, type === 'PDF' ? 5 : 2).toString(),
        type === 'PDF' ? '%PDF-' : 'PK',
      );
      if (type === 'DOCX') {
        const office = unzipSync(bytes);
        const body = Buffer.from(office['word/document.xml']).toString();
        assert.match(body, /Tiếng Việt/);
        assert.match(body, /<w:tbl/);
        assert.match(body, /<w:drawing/);
        assert.match(body, /<w:strike/);
        assert.match(body, /FFFF00/i);
        writeFileSync(`${report}/docsnest-export-roundtrip.docx`, bytes);
      }
    }
    stage = 'reopen saved import';
    await page.reload();
    await page.getByRole('button', { name: 'New', exact: true }).waitFor();
    await page.getByRole('button', { name: title, exact: true }).click();
    await page
      .locator('.cm-content')
      .getByText('Kế hoạch viết cùng docsnest', { exact: true })
      .waitFor();
    assert.equal(await page.locator('.editor-table td[data-cell]').count(), 4);
    page.once('dialog', (dialog) => dialog.accept());
    await selectFile(
      page,
      readFileSync(`${report}/docsnest-export-roundtrip.docx`),
      'roundtrip.docx',
      true,
    );
    await page.locator('.save-status').getByText('Unsaved', { exact: true }).waitFor();
    assert.equal(await page.locator('.editor-table td[data-cell]').count(), 4);
    await page.getByRole('button', { name: 'Document list', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search this library', exact: true }).fill(title);
    await page.waitForFunction(() => document.querySelectorAll('.document-file').length === 1);
    stage = 'settings preserve editor and respond to system theme';
    const preferencesEditor = await page.locator('.cm-content').elementHandle();
    let dialog = await settings(page);
    await dialog.getByRole('radio', { name: 'Dark', exact: true }).check();
    await theme(page, 'dark');
    assert.equal(
      await page.locator('.workspace').evaluate((node) => getComputedStyle(node).backgroundColor),
      'rgb(34, 38, 46)',
    );
    await dialog.getByRole('combobox', { name: 'Language', exact: true }).selectOption('vi');
    await page.getByRole('dialog', { name: 'Cài đặt', exact: true }).waitFor();
    assert.equal(
      await preferencesEditor.evaluate((node) => node === document.querySelector('.cm-content')),
      true,
      'Settings keep the live editor node',
    );
    await page.screenshot({ path: `${report}/docsnest-settings-dark.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Mới', exact: true }).waitFor();
    await page.screenshot({ path: `${report}/docsnest-dark.png` });
    await page.reload();
    await page.getByRole('button', { name: 'Mới', exact: true }).waitFor();
    await theme(page, 'dark');
    dialog = await settings(page, true);
    await dialog.getByRole('radio', { name: 'Theo trình duyệt', exact: true }).check();
    await theme(page, 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await theme(page, 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await theme(page, 'light');
    await dialog.getByRole('radio', { name: 'Sáng', exact: true }).check();
    await page.screenshot({ path: `${report}/docsnest-settings-light.png` });
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    stage = 'subscription design and mobile';
    await accountMenu(page, true);
    await page.getByRole('menuitem', { name: 'Gói dịch vụ', exact: true }).click();
    const billing = page.getByRole('dialog', { name: 'Gói dịch vụ', exact: true });
    await billing
      .locator('p')
      .filter({ hasText: /^Gói hiện tại:\s*Miễn phí/ })
      .waitFor();
    await billing
      .getByRole('heading', { name: 'Một nơi cho mọi bản thảo.', exact: true })
      .waitFor();
    await billing.getByRole('button', { name: 'Hàng tháng', exact: true }).click();
    assert.equal(
      await billing
        .getByRole('button', { name: 'Hàng tháng', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await billing.getByRole('button', { name: 'Hàng năm', exact: true }).click();
    await page.screenshot({ path: `${report}/docsnest-subscription.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.equal(
      await billing.locator('.panel').evaluate((node) => node.scrollWidth <= node.clientWidth),
      true,
    );
    await page.screenshot({ path: `${report}/docsnest-subscription-mobile.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 960 });
    stage = 'two accounts in same browser keep separate preferences';
    dialog = await settings(page, true);
    await dialog.getByRole('radio', { name: 'Tối', exact: true }).check();
    await page.keyboard.press('Escape');
    await accountMenu(page, true);
    await page.getByRole('menuitem', { name: 'Đăng xuất', exact: true }).click();
    await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Ngôn ngữ', exact: true }).selectOption('en');
    const second = await login(page, 'smoke-owner@editor.test');
    await page.getByRole('button', { name: 'New', exact: true }).waitFor();
    await theme(page, 'light');
    dialog = await settings(page);
    await dialog.getByRole('radio', { name: 'Light', exact: true }).check();
    await dialog.getByRole('combobox', { name: 'Language', exact: true }).selectOption('en');
    await page.keyboard.press('Escape');
    const stored = await page.evaluate(
      ([first, second]) => [
        localStorage.getItem(`docsnest:preferences:${first}`),
        localStorage.getItem(`docsnest:preferences:${second}`),
      ],
      [owner.user.id, second.user.id],
    );
    assert.deepEqual(JSON.parse(stored[0]), { theme: 'dark', locale: 'vi' });
    assert.deepEqual(JSON.parse(stored[1]), { theme: 'light', locale: 'en' });
    await accountMenu(page);
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await page.getByRole('textbox', { name: 'Password', exact: true }).waitFor();
    owner = await login(page, 'smoke-recipient@editor.test');
    await page.getByRole('button', { name: 'Mới', exact: true }).waitFor();
    await theme(page, 'dark');
    assert.deepEqual(errors, [], 'No browser exceptions');
    console.log(
      'PASS docsnest dropdowns, two-account preferences, system theme, subscriptions, DOCX import/save/reopen/roundtrip and real DOCX/PDF downloads',
    );
  } catch (error) {
    console.error(`FAIL docsnest browser stage: ${stage}`);
    console.error(
      JSON.stringify({
        errorType: error.name,
        code: error.code,
        testLine: error.stack
          ?.split('\n')
          .find((line) => line.includes('docsnest-browser.cjs:'))
          ?.trim(),
      }),
    );
    await page
      .screenshot({ path: `${report}/docsnest-browser-failure.png`, fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    if (owner && documentId) {
      try {
        const current = await api(context, owner.accessToken, `/api/v1/documents/${documentId}`);
        await api(
          context,
          owner.accessToken,
          `/api/v1/documents/${documentId}`,
          'DELETE',
          { expectedMetadataRevision: current.metadataRevision },
          204,
        );
      } catch {
        console.error('Disposable DOCX fixture cleanup failed');
      }
    }
    await browser.close();
  }
})().catch(() => {
  process.exitCode = 1;
});
