/* Real service and browser acceptance for managed source files; no intercepted responses. */
const { chromium, expect } = require('@playwright/test');
const { readFileSync, mkdirSync, existsSync } = require('node:fs');
const { createServer } = require('node:http');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8080';
const rootSecret = /^MYSQL_ROOT_PASSWORD=(.*)$/m.exec(readFileSync('.env', 'utf8'))?.[1]?.trim();
assert.ok(rootSecret);
const reports = 'testing/reports/raw';
async function main() {
  const browser = await chromium.launch();
  const staticRoot = path.resolve('frontend/web/dist/local-site');
  assert.ok(existsSync(path.join(staticRoot, 'editor.html')), 'Build the standalone site first');
  const server = createServer((request, response) => {
    const file = path.resolve(staticRoot, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(staticRoot + path.sep) || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const mime =
      { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] ??
      'application/octet-stream';
    response.writeHead(200, { 'Content-Type': mime }).end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const localOrigin = `http://${new URL(base).hostname}:${server.address().port}`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const created = [];
  let stage = 'accounts',
    pageErrors = 0,
    token;
  async function account(target, email) {
    const password = createHash('sha256')
      .update(rootSecret + email)
      .digest('hex')
      .slice(0, 32);
    const csrf = await (await target.request.get(base + '/api/v1/auth/csrf')).json();
    const response = await target.request.post(base + '/api/v1/auth/register', {
      headers: { Origin: base, [csrf.headerName]: csrf.token },
      data: { email, password, displayName: 'Source Tools' },
    });
    assert.ok([201, 409].includes(response.status()));
    return { email, password };
  }
  async function login(page, user) {
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(user.email);
    await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(user.password);
    const response = page.waitForResponse(
      (value) => value.url().endsWith('/api/v1/auth/login') && value.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    return (await response).json();
  }
  async function info(id) {
    const response = await context.request.get(`${base}/api/v1/documents/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status(), 200);
    return response.json();
  }
  const page = await context.newPage();
  page.on('pageerror', () => pageErrors++);
  page.on('response', async (response) => {
    if (response.status() >= 400 && response.url().includes('/api/')) {
      const value = await response.json().catch(() => ({}));
      if (typeof value.code === 'string' && /^[A-Z_]+$/.test(value.code))
        console.log(`API diagnostic ${response.status()} ${value.code}`);
    }
  });
  page.on('dialog', (dialog) => void dialog.accept(dialog.defaultValue()));
  const pane = page.locator('.source-file-pane');
  const source = pane.locator('.cloud-source-editor .cm-content');
  async function save(id) {
    await pane.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(pane.locator('.source-file-heading [role=status]')).toHaveText('Đã lưu');
    assert.ok((await info(id)).headRevision > 0);
  }
  async function reopen(id) {
    await page.getByRole('button', { name: 'Danh sách tài liệu', exact: true }).click();
    await page.locator(`[data-document-id="${id}"] .file-name`).click();
    await expect(pane).toBeVisible();
  }
  try {
    mkdirSync(reports, { recursive: true });
    const owner = await account(context, 'smoke-recipient@editor.test');
    stage = 'standalone login link';
    await page.goto(localOrigin + '/editor.html');
    await page.getByRole('link', { name: 'Đăng nhập', exact: true }).click();
    assert.equal(new URL(page.url()).origin, base);
    const session = await login(page, owner);
    token = session.accessToken;
    const initial = Array.from(session.user.displayName)[0].toLocaleUpperCase();
    await expect(page.locator('.workspace')).toBeVisible();
    stage = 'intro and standalone avatar';
    const local = await context.newPage();
    local.on('pageerror', () => pageErrors++);
    let localApi = 0;
    local.on('request', (request) => {
      if (request.url().includes('/api/')) localApi++;
    });
    for (const url of [base + '/intro', localOrigin + '/editor.html']) {
      await local.goto(url);
      await expect(local.getByRole('link', { name: 'Quản lý tệp', exact: true })).toContainText(
        initial,
      );
    }
    assert.equal(localApi, 0);
    await local.close();
    const files = [
      ['Guide.md', '# Bản thảo Việt\n\n```typescript\nconst id = 1;\n```\n'],
      ['data.json', '{"id":900719925474099312345,"name":"Việt"}\n'],
      ['snippet.py', 'def greet(name):\n    return "Việt " + name\n'],
    ];
    let jsonId, codeId;
    for (const [name, text] of files) {
      stage = 'import/save/reopen ' + name.split('.').at(-1);
      const pending = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/documents' &&
          response.request().method() === 'POST',
      );
      await page
        .getByLabel('Nhập tệp', { exact: true })
        .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
      const document = await (await pending).json();
      created.push(document.id);
      if (name.endsWith('.json')) jsonId = document.id;
      if (name.endsWith('.py')) codeId = document.id;
      await expect(pane.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(source).toHaveText(text.trimEnd(), { useInnerText: true });
      await expect(pane.locator('.cloud-source-editor .cm-lineNumbers')).toBeVisible();
      if (name.endsWith('.md'))
        await expect(pane.locator('.preview-pane h1')).toHaveText('Bản thảo Việt');
      await save(document.id);
      await reopen(document.id);
      await expect(source).toHaveText(text.trimEnd(), { useInnerText: true });
      const downloaded = page.waitForEvent('download');
      await pane.getByRole('button', { name: 'Tải tệp', exact: true }).click();
      const file = await downloaded;
      assert.equal(file.suggestedFilename(), name);
      await file.saveAs(`${reports}/managed-${name}`);
      assert.equal(readFileSync(`${reports}/managed-${name}`).toString('utf8'), text);
      if (name.endsWith('.json')) {
        await pane.getByRole('button', { name: 'Căn lề', exact: true }).click();
        const result = pane.locator('.json-output .cm-content');
        await expect(result).toContainText('900719925474099312345');
        await result.fill('{"id":900719925474099312345,"edited":true}');
        await pane.getByRole('button', { name: 'Dùng kết quả', exact: true }).click();
        await expect(source).toHaveText('{"id":900719925474099312345,"edited":true}');
        await save(document.id);
        await reopen(document.id);
        await expect(source).toContainText('"edited":true');
      }
      if (name.endsWith('.py')) {
        await expect(pane.locator('.cloud-source-editor .tok-keyword').first()).toBeVisible();
        assert.match(
          await pane
            .locator('.cm-scroller')
            .first()
            .evaluate((node) => getComputedStyle(node).fontFamily),
          /Consolas|monospace/,
        );
        await source.press('Control+End');
        await source.press('Tab');
        await source.pressSequentially('# added');
        await expect(source).toContainText('    # added');
        await save(document.id);
      }
      await page.getByRole('button', { name: 'Danh sách tài liệu', exact: true }).click();
      await expect(page.locator(`[data-document-id="${document.id}"] .file-kind`)).toHaveText(
        name.endsWith('.md') ? 'Markdown' : name.endsWith('.json') ? 'JSON' : 'Code',
      );
    }
    stage = 'new source file';
    await page.getByRole('button', { name: 'Mới', exact: true }).click();
    const pending = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/documents' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('menuitem', { name: 'Tệp Markdown mới', exact: true }).click();
    const fresh = await (await pending).json();
    created.push(fresh.id);
    await expect(pane.getByRole('heading', { name: 'Ban-thao.md', exact: true })).toBeVisible();
    await source.fill('# New Markdown');
    await save(fresh.id);
    await page.getByRole('button', { name: 'Danh sách tài liệu', exact: true }).click();
    await page.getByLabel('Loại', { exact: true }).selectOption('json');
    await expect(page.locator('.document-file')).toHaveCount(1);
    await page.getByLabel('Loại', { exact: true }).selectOption('all');
    await page.locator(`[data-document-id="${codeId}"] .file-name`).click();
    await expect(pane.getByRole('heading', { name: 'snippet.py', exact: true })).toBeVisible();
    await expect(source).toContainText('# added');
    stage = 'offline native draft recovery';
    await context.setOffline(true);
    await source.fill('print("offline Việt")\n');
    await expect(pane.locator('.source-file-heading [role=status]')).toHaveText('Ngoại tuyến');
    await context.setOffline(false);
    // Opening another file checkpoints the dirty source model via the existing draft store.
    await page.getByRole('button', { name: 'Danh sách tài liệu', exact: true }).click();
    await page.locator(`[data-document-id="${jsonId}"] .file-name`).click();
    await reopen(codeId);
    await pane.getByRole('button', { name: 'Khôi phục bản nháp', exact: true }).click();
    await expect(source).toContainText('offline Việt');
    await save(codeId);
    stage = 'optimistic source conflict';
    const second = await context.newPage();
    second.on('pageerror', () => pageErrors++);
    await second.goto(base);
    await second.locator(`[data-document-id="${codeId}"] .file-name`).click();
    await expect(second.locator('.cloud-source-editor .cm-content')).toContainText('offline Việt');
    await source.fill('print("first revision")\n');
    await save(codeId);
    await second
      .locator('.cloud-source-editor .cm-content')
      .fill('print("retained conflicting draft")\n');
    await second
      .locator('.source-file-heading')
      .getByRole('button', { name: 'Lưu', exact: true })
      .click();
    await expect(second.locator('.source-file-heading [role=status]')).toHaveText('Xung đột');
    await expect(second.locator('.cloud-source-editor .cm-content')).toContainText(
      'retained conflicting draft',
    );
    await second.close();
    await reopen(codeId);
    await expect(source).toContainText('first revision');
    stage = 'viewer ACL';
    const viewerContext = await browser.newContext();
    try {
      const viewer = await account(viewerContext, 'smoke-owner@editor.test');
      const granted = await context.request.post(`${base}/api/v1/documents/${jsonId}/permissions`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { email: viewer.email, role: 'VIEWER' },
      });
      assert.equal(granted.status(), 200);
      const viewerPage = await viewerContext.newPage();
      viewerPage.on('pageerror', () => pageErrors++);
      await viewerPage.goto(base);
      await login(viewerPage, viewer);
      await viewerPage.getByRole('button', { name: 'Được chia sẻ', exact: true }).click();
      await viewerPage.locator(`[data-document-id="${jsonId}"] .file-name`).click();
      await expect(
        viewerPage
          .locator('.source-file-heading')
          .getByRole('button', { name: 'Lưu', exact: true }),
      ).toBeDisabled();
      await expect(viewerPage.locator('.cloud-source-editor .cm-content')).toHaveAttribute(
        'contenteditable',
        'false',
      );
      await expect(
        viewerPage.getByRole('button', { name: 'Dùng kết quả', exact: true }),
      ).toBeDisabled();
      await viewerPage.getByRole('button', { name: 'Căn lề', exact: true }).click();
      await expect(viewerPage.locator('.json-output .cm-content')).toContainText(
        '900719925474099312345',
      );
    } finally {
      await viewerContext.close();
    }
    stage = 'mobile and logout';
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page
      .getByRole('button', { name: `Tài khoản của ${session.user.displayName}`, exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Đăng xuất', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
    await page.goto(localOrigin + '/editor.html');
    await expect(page.getByRole('link', { name: 'Đăng nhập', exact: true })).toBeVisible();
    assert.equal(pageErrors, 0);
    console.log(
      'PASS managed MD/JSON/code import/create/save/download/reopen, native source edits, JSON result, type filter, offline draft recovery, SQL revision conflict, viewer ACL, local login/avatar/logout and mobile; zero page errors',
    );
  } catch (failure) {
    await page.screenshot({ path: `${reports}/source-files-failure.png`, fullPage: true });
    const line =
      /source-files-browser\.cjs:(\d+)/.exec(
        failure instanceof Error ? (failure.stack ?? '') : '',
      )?.[1] ?? 'unknown';
    console.error(
      `FAIL source files browser at ${stage}, ${failure instanceof Error ? failure.name : 'Error'}, test line ${line}`,
    );
    process.exitCode = 1;
  } finally {
    // Test documents only; retain service data and never print credentials/content.
    if (token)
      for (const id of created) {
        const document = await info(id).catch(() => null);
        if (document && !document.deletedAt)
          await context.request
            .delete(`${base}/api/v1/documents/${id}`, {
              headers: { Authorization: `Bearer ${token}` },
              data: { expectedMetadataRevision: document.metadataRevision },
            })
            .catch(() => {});
      }
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
void main().catch(() => {
  console.error('FAIL source files browser initialization');
  process.exitCode = 1;
});
