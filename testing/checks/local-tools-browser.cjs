/* Actual compiled static site, with no API mocks, login or backend dependency. */
const { chromium, expect } = require('@playwright/test');
const { createServer } = require('node:http');
const { readFileSync, existsSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');
const markdownScroll = require('./markdown-scroll.cjs');
const root = path.resolve('frontend/web/dist/local-site');
const reports = 'testing/reports/raw';
const markdown =
  '# Bản thảo Việt\n\n**Rõ ràng** và _tập trung_.\n\n- [x] Viết ý tưởng\n\n| A | B |\n| --- | --- |\n| Markdown | JSON |\n\n```typescript\nconst title: string = "docsnest";\n```\n';
const word = zipSync({
  '[Content_Types].xml': strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ),
  'word/document.xml': strToU8(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/><w:color w:val="1A73E8"/></w:rPr><w:t>Bản thảo Việt</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Viết mỗi ngày</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Markdown</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Code</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
  ),
  'word/numbering.xml': strToU8(
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>',
  ),
});
async function main() {
  assert.ok(existsSync(path.join(root, 'editor.html')), 'Build the local static site first');
  mkdirSync(reports, { recursive: true });
  const server = createServer((request, response) => {
    const file = path.resolve(
      root,
      '.' +
        decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(
          /^\/nested\//,
          '/',
        ),
    );
    if (!file.startsWith(root + path.sep) || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const mime =
      { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] ||
      'application/octet-stream';
    response.writeHead(200, { 'Content-Type': mime });
    response.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  let errors = 0,
    api = 0,
    remote = 0,
    stage = 'intro';
  page.on('pageerror', () => errors++);
  context.on('page', (child) => child.on('pageerror', () => errors++));
  context.on('request', (request) => {
    const url = request.url();
    if (/\/api\/|\/\.well-known\/|wss?:/.test(url)) api++;
    if (url.startsWith('http') && !url.startsWith(origin + '/')) remote++;
  });
  page.on('dialog', (dialog) => void dialog.accept());
  const upload = (file) => page.locator('.local-heading input[type=file]').setInputFiles(file);
  const source = () => page.locator('[role=tabpanel]:visible .source-editor .cm-content').first();
  async function download(button, output) {
    const pending = page.waitForEvent('download');
    await button.click();
    const file = await pending;
    await file.saveAs(path.join(reports, output));
    return readFileSync(path.join(reports, output));
  }
  try {
    await page.goto(origin + '/index.html');
    await expect(page.locator('.intro-words h1')).toHaveText('Viết thành ý. Giữ thành tệp.');
    await page.screenshot({ path: `${reports}/local-intro.png`, fullPage: true });
    await page.getByRole('link', { name: 'Mở trình soạn thảo', exact: true }).first().click();
    await expect(page.getByRole('tab', { name: 'Markdown', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    stage = 'markdown scroll synchronization';
    await markdownScroll(page, upload);
    stage = 'markdown';
    await upload({ name: 'ban-thao.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
    await expect(page.locator('.preview-pane h1')).toHaveText('Bản thảo Việt');
    assert.equal(await page.locator('.preview-pane table').count(), 1);
    assert.equal(await page.locator('.preview-pane input[type=checkbox]:checked').count(), 1);
    assert.ok(await page.locator('.preview-pane .tok-keyword').count());
    const mdBytes = await download(
      page.getByRole('button', { name: 'Tải tệp', exact: true }),
      'local-roundtrip.md',
    );
    assert.equal(mdBytes.toString('utf8'), markdown);
    const html = (
      await download(
        page.getByRole('button', { name: 'Tải HTML', exact: true }),
        'local-markdown.html',
      )
    ).toString('utf8');
    assert.ok(
      html.includes('<table>') && html.includes('tok-keyword') && html.includes('Bản thảo Việt'),
    );
    const printer = await context.newPage();
    await printer.setContent(html);
    const pdf = await printer.pdf({
      path: `${reports}/local-markdown.pdf`,
      format: 'A4',
      printBackground: true,
    });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    await printer.close();
    const attached = page.waitForEvent('frameattached');
    await page.getByRole('button', { name: 'In / Lưu PDF', exact: true }).click();
    await attached;
    await expect(page.getByRole('status').first()).toContainText('PDF');
    await page.screenshot({ path: `${reports}/local-markdown.png`, fullPage: true });
    await source().evaluate((node) => {
      node.dataset.acceptanceIdentity = 'source';
    });
    await source().fill('hello');
    await source().press('Control+a');
    await page.getByRole('button', { name: 'Đậm', exact: true }).click();
    await expect(source()).toHaveText('**hello**');
    await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
    await expect(source()).toHaveText('hello');
    // HTML is inert; automatic remote image loads and unsafe link protocols are disabled.
    await source().fill(
      '# Safe\n<script>window.__injected = true</script>\n\n![remote](https://example.invalid/track.png)\n[bad](javascript:alert(1))',
    );
    await expect(page.locator('.preview-pane h1')).toHaveText('Safe');
    assert.equal(await page.locator('.preview-pane img, .preview-pane script').count(), 0);
    assert.equal(await page.evaluate(() => window.__injected), undefined);
    assert.equal(await page.locator('.preview-pane a').getAttribute('href'), '');
    stage = 'code';
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
    await upload({
      name: 'snippet.py',
      mimeType: 'text/plain',
      buffer: Buffer.from('def greet(name):\n    return "Việt " + name\n'),
    });
    await expect(page.getByLabel('Ngôn ngữ code', { exact: true })).toHaveValue('python');
    await expect(page.locator('#local-code .tok-keyword').first()).toBeVisible();
    assert.ok(await page.locator('#local-code .cm-lineNumbers').count());
    await page.screenshot({ path: `${reports}/local-code.png`, fullPage: true });
    const tsx = 'const App = () => <main>Việt</main>;\n';
    await upload({ name: 'component.tsx', mimeType: 'text/plain', buffer: Buffer.from(tsx) });
    const tsxDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Tải tệp', exact: true }).click();
    const tsxFile = await tsxDownload;
    assert.equal(tsxFile.suggestedFilename(), 'component.tsx');
    await tsxFile.saveAs(`${reports}/local-component.tsx`);
    assert.equal(readFileSync(`${reports}/local-component.tsx`).toString('utf8'), tsx);
    stage = 'json';
    await page.getByRole('tab', { name: 'JSON', exact: true }).click();
    const original = '{"id":900719925474099312345,"n":1.234567890123456789e+42,"label":"Việt 👋"}';
    await upload({
      name: 'data.json',
      mimeType: 'application/json',
      buffer: Buffer.from(original),
    });
    await page.getByRole('button', { name: 'Căn lề', exact: true }).click();
    await expect(page.getByLabel('Kết quả kiểm tra JSON')).toHaveText('JSON hợp lệ.');
    const output = page.locator('#local-json .json-output .cm-content');
    await expect(output).toContainText('900719925474099312345');
    assert.ok((await output.innerText()).includes('\n'));
    await expect(source()).toHaveText(original);
    await output.fill('{"edited":true,"id":900719925474099312345}');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page
      .locator('#local-json')
      .getByRole('button', { name: 'Sao chép', exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      '{"edited":true,"id":900719925474099312345}',
    );
    const edited = await download(
      page.getByRole('button', { name: 'Tải kết quả', exact: true }),
      'local-json-result.json',
    );
    assert.equal(edited.toString('utf8'), '{"edited":true,"id":900719925474099312345}');
    await page.getByRole('button', { name: 'Dùng kết quả', exact: true }).click();
    await expect(source()).toHaveText('{"edited":true,"id":900719925474099312345}');
    await source().fill(original);
    assert.ok((await source().innerText()).includes('900719925474099312345'));
    await page.screenshot({ path: `${reports}/local-json.png`, fullPage: true });
    await page.getByRole('button', { name: 'Thu gọn', exact: true }).click();
    await expect(output).toHaveText(original);
    await expect(source()).toHaveText(original);
    const jsonBytes = await download(
      page.getByRole('button', { name: 'Tải tệp', exact: true }),
      'local-data.json',
    );
    assert.equal(jsonBytes.toString('utf8'), original);
    await source().fill('{"x":}');
    await page.getByRole('button', { name: 'Căn lề', exact: true }).click();
    await expect(source()).toHaveText('{"x":}');
    await expect(page.getByLabel('Kết quả kiểm tra JSON')).toContainText('dòng 1');
    await expect(output).toHaveText(original);
    // Changing modes/language/theme keeps the same mounted documents and undo stack.
    await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
    await expect(source()).toContainText('# Safe');
    assert.equal(await source().getAttribute('data-acceptance-identity'), 'source');
    await page.getByRole('tab', { name: 'JSON', exact: true }).click();
    await expect(source()).toHaveText('{"x":}');
    await page.getByLabel('Ngôn ngữ', { exact: true }).selectOption('en');
    await expect(page.getByRole('button', { name: 'Format', exact: true })).toBeVisible();
    await expect(source()).toHaveText('{"x":}');
    await page.getByLabel('Appearance', { exact: true }).selectOption('dark');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.getByLabel('Language', { exact: true }).selectOption('vi');
    stage = 'document';
    await upload({
      name: 'draft.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(word),
    });
    await expect(page.getByRole('tab', { name: 'Văn bản', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const rich = page.locator('#local-document .cm-content');
    await expect(rich).toContainText('Bản thảo Việt');
    await expect
      .poll(async () => {
        const worker = page.workers()[0];
        return worker ? worker.evaluate(() => typeof self.onmessage) : 'pending';
      })
      .toBe('function');
    assert.equal(await page.locator('#local-document .cm-content table').count(), 1);
    const native = await download(
      page
        .locator('#local-document .editor-heading')
        .getByRole('button', { name: 'Tải bản native', exact: true }),
      'local-draft.tedoc',
    );
    assert.ok(unzipSync(native)['manifest.json']);
    const menu = page
      .locator('#local-document details')
      .filter({ has: page.locator('summary', { hasText: 'Tệp' }) });
    await menu.locator('summary').click();
    const docx = await download(
      menu.getByRole('button', { name: 'Xuất DOCX', exact: true }),
      'local-draft.docx',
    );
    const entries = unzipSync(docx);
    const xml = strFromU8(entries['word/document.xml']);
    assert.ok(
      xml.includes('Bản thảo Việt') &&
        xml.includes('<w:b') &&
        xml.includes('<w:tbl') &&
        xml.includes('<w:numPr'),
    );
    await upload({
      name: 'roundtrip.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docx,
    });
    await expect(rich).toContainText('Bản thảo Việt');
    await menu.locator('summary').click();
    const docHtml = await download(
      menu.getByRole('button', { name: 'Tải HTML', exact: true }),
      'local-document.html',
    );
    assert.ok(docHtml.toString('utf8').includes('<table>'));
    await page.screenshot({ path: `${reports}/local-document-dark.png`, fullPage: true });
    await rich.press('Control+Home');
    await rich.pressSequentially('Changed ');
    page.removeAllListeners('dialog');
    const dismissed = new Promise((resolve) =>
      page.once('dialog', async (dialog) => {
        await dialog.dismiss();
        resolve();
      }),
    );
    await upload({
      name: 'canceled.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(word),
    });
    await dismissed;
    await expect(rich).toContainText('Changed');
    await expect(page.getByLabel('Tên tệp', { exact: true })).toHaveValue('roundtrip.docx');
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
    await source().fill(markdown);
    await context.setOffline(true);
    await source().press('Control+End');
    await source().press('Enter');
    await source().pressSequentially('Offline');
    await expect(page.locator('.preview-pane')).toContainText('Offline');
    await download(page.getByRole('button', { name: 'Tải tệp', exact: true }), 'local-offline.md');
    await context.setOffline(false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${reports}/local-mobile.png`, fullPage: true });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    );
    stage = 'static subdirectory';
    const nested = await context.newPage();
    await nested.goto(origin + '/nested/editor.html?mode=document');
    await expect(nested.getByRole('tab', { name: 'Văn bản', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await nested.locator('#local-document .cm-content').fill('Nested local worker');
    await expect(nested.locator('#local-document .cm-content')).toHaveText('Nested local worker');
    await expect
      .poll(async () => {
        const worker = nested.workers()[0];
        return worker ? worker.evaluate(() => typeof self.onmessage) : 'pending';
      })
      .toBe('function');
    await nested.close();
    assert.equal(api, 0);
    assert.equal(remote, 0);
    assert.equal(errors, 0);
    console.log(
      'PASS static docsnest intro/local Markdown/code/JSON/document tools, real files/DOCX roundtrip, offline edits, safe preview, bilingual themes and mobile; zero API/remote requests',
    );
  } catch (error) {
    const testLine =
      /(?:local-tools-browser|markdown-scroll)\.cjs:(\d+)/.exec(
        error instanceof Error ? (error.stack ?? '') : '',
      )?.[1] ?? 'unknown';
    const diagnostic = `${error instanceof Error ? error.name : 'Error'} at ${stage}, test line ${testLine}`;
    console.error('FAIL local tools browser: ' + diagnostic);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
void main().catch(() => {
  console.error('FAIL local tools browser initialization');
  process.exitCode = 1;
});
