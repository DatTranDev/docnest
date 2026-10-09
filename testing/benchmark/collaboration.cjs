/* One real-browser sample at the collaboration limit; no cloud or invented targets. */
const { chromium } = require('playwright');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const base = 'http://localhost:8080';
const root = /^MYSQL_ROOT_PASSWORD=(.*)$/m.exec(readFileSync('.env', 'utf8'))?.[1]?.trim();
// Reuse the normal smoke account to avoid spending another lab account slot.
const email = 'smoke-owner@editor.test';
if (!root) throw new Error('Initialize the local stack first');
const password = createHash('sha256')
  .update(root + email)
  .digest('hex')
  .slice(0, 32);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  let token, document;
  async function api(path, method = 'GET', body) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.ok, `API status ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  try {
    const csrf = await (await page.context().request.get(base + '/api/v1/auth/csrf')).json();
    const registration = await page.context().request.post(base + '/api/v1/auth/register', {
      headers: { Origin: base, [csrf.headerName]: csrf.token },
      data: { email, password, displayName: 'Collaboration benchmark' },
    });
    assert.ok(
      [201, 409].includes(registration.status()),
      `Benchmark account registration status ${registration.status()}`,
    );
    await page.goto(base);
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
    const loggedIn = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    const login = await loggedIn;
    assert.equal(login.status(), 200, 'Benchmark login');
    token = (await login.json()).accessToken;
    await page.getByRole('button', { name: '+ Tài liệu mới' }).waitFor();
    const title = `Collaboration boundary benchmark ${Date.now()}`;
    document = await api('/api/v1/documents', 'POST', { title, folderId: null });
    await page.reload();
    await page.getByRole('button', { name: title, exact: true }).last().click();
    await page.locator('.cm-content').click();
    await page.keyboard.insertText('x'.repeat(200000));
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByText('Đã lưu', { exact: true }).waitFor({ timeout: 30000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    const before = await cdp.send('Runtime.getHeapUsage');
    const started = performance.now();
    await page.getByRole('button', { name: 'Cùng chỉnh sửa', exact: true }).click();
    await page
      .getByRole('button', { name: 'Đã đồng bộ cộng tác', exact: true })
      .waitFor({ timeout: 30000 });
    const joinMs = performance.now() - started;
    await cdp.send('HeapProfiler.collectGarbage');
    const after = await cdp.send('Runtime.getHeapUsage');
    const domLines = await page.locator('.cm-line').count();
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText('z');
    await page.getByRole('alert').filter({ hasText: 'COLLABORATION_TEXT_LIMIT' }).waitFor();
    assert.equal(
      (await page.locator('.cm-content').textContent()).includes('z'),
      false,
      'Rejected edit must not remain in the rendered editor',
    );
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByText('Đã lưu', { exact: true }).waitFor({ timeout: 30000 });
    const versions = await api(`/api/v1/documents/${document.id}/versions?limit=1`);
    assert.equal(
      versions.items[0].utf16Length,
      200000,
      'Rejected edit must not enter native persistence',
    );
    const report = {
      workload: '200000 ASCII UTF-16 units',
      samples: 1,
      joinMs,
      extraMainJsHeapMiB: (after.usedSize - before.usedSize) / 1048576,
      domLines,
      overflowRejected: true,
      scope:
        'Real local browser/services; CDP main-page JS heap after GC excludes worker/native/browser/process RAM. Single sample, no acceptance target. Full large-file benchmarks not implied.',
    };
    mkdirSync('testing/reports', { recursive: true });
    writeFileSync('testing/reports/collaboration-benchmark.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    if (token && document) {
      const current = await api(`/api/v1/documents/${document.id}`);
      await api(`/api/v1/documents/${document.id}`, 'DELETE', {
        expectedMetadataRevision: current.metadataRevision,
      });
    }
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
