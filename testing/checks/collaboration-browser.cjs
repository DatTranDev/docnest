/* Real-service smoke. Requires run.py up and Playwright Chromium. No mocked routes. */
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:8080';
const root = /^MYSQL_ROOT_PASSWORD=(.*)$/m.exec(readFileSync('.env', 'utf8'))?.[1]?.trim();
if (!root) throw new Error('Local environment must be initialized first');

async function login(browser, email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const password = createHash('sha256')
    .update(root + email)
    .digest('hex')
    .slice(0, 32);
  const csrf = await (await context.request.get(base + '/api/v1/auth/csrf')).json();
  const registration = await context.request.post(base + '/api/v1/auth/register', {
    headers: { Origin: base, [csrf.headerName]: csrf.token },
    data: { email, password, displayName: 'Collaboration smoke' },
  });
  assert.ok([201, 409].includes(registration.status()));
  await page.goto(base);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
  const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const session = await (await response).json();
  assert.ok(session.accessToken);
  await page.getByRole('button', { name: '+ Tài liệu mới' }).waitFor();
  return { context, page, token: session.accessToken, user: session.user };
}
async function api(user, path, method = 'GET', data, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${user.token}`,
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  assert.equal(response.status, expected, `${method} API status`);
  return response.status === 204 ? undefined : response.json();
}
async function editorText(page) {
  return page.locator('.cm-content').innerText();
}
async function converge(a, b, predicate) {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    const left = await editorText(a),
      right = await editorText(b);
    if (left === right && predicate(left)) return left;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  console.error(
    'Convergence diagnostics',
    JSON.stringify({
      leftLength: (await editorText(a)).length,
      rightLength: (await editorText(b)).length,
    }),
  );
  throw new Error('Editors did not converge within 20 seconds');
}
async function typeEnd(page, value) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(value);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let owner, document;
  try {
    owner = await login(browser, 'smoke-owner@editor.test');
    const guest = await login(browser, 'smoke-recipient@editor.test');
    const title = `Collaboration smoke ${Date.now()}`;
    document = await api(owner, '/api/v1/documents', 'POST', { title, folderId: null }, 201);
    await api(owner, `/api/v1/documents/${document.id}/permissions`, 'POST', {
      email: 'smoke-recipient@editor.test',
      role: 'EDITOR',
    });
    await owner.page.reload();
    await guest.page.reload();
    await owner.page.getByRole('button', { name: title, exact: true }).last().click();
    await guest.page.getByRole('button', { name: 'Được chia sẻ', exact: true }).click();
    await guest.page.getByRole('button', { name: title, exact: true }).last().click();
    for (const user of [owner, guest]) {
      await user.page.getByRole('button', { name: 'Cùng chỉnh sửa', exact: true }).click();
      await user.page
        .getByRole('button', { name: 'Đã đồng bộ cộng tác', exact: true })
        .waitFor({ timeout: 20000 });
    }
    console.log('check: concurrent offline insert');
    await owner.context.setOffline(true);
    await guest.context.setOffline(true);
    await typeEnd(owner.page, 'Alice');
    await typeEnd(guest.page, 'Bob');
    await new Promise((resolve) => setTimeout(resolve, 800));
    await owner.context.setOffline(false);
    await guest.context.setOffline(false);
    await converge(
      owner.page,
      guest.page,
      (text) => text.includes('Alice') && text.includes('Bob'),
    );
    await owner.page.locator('.cm-content').click();
    console.log('check: selective undo');
    await owner.page.keyboard.press('ControlOrMeta+z');
    await converge(owner.page, guest.page, (text) => text === 'Bob');
    console.log('check: selective redo');
    await owner.page.getByRole('button', { name: 'Làm lại', exact: true }).click();
    await converge(
      owner.page,
      guest.page,
      (text) => text.includes('Alice') && text.includes('Bob'),
    );
    console.log('check: concurrent formatting and image');
    await owner.page.locator('.cm-content').click();
    await owner.page.keyboard.press('ControlOrMeta+End');
    await guest.page.locator('.cm-content').click();
    await guest.page.keyboard.press('ControlOrMeta+End');
    await Promise.all([
      owner.page.keyboard.type('x'.repeat(20), { delay: 60 }),
      guest.page.keyboard.type('y'.repeat(20), { delay: 60 }),
    ]);
    await converge(
      owner.page,
      guest.page,
      (text) => (text.match(/x/g) ?? []).length === 20 && (text.match(/y/g) ?? []).length === 20,
    );
    await owner.context.setOffline(true);
    await guest.context.setOffline(true);
    for (const user of [owner, guest]) {
      await user.page.locator('.cm-content').click();
      await user.page.keyboard.press('ControlOrMeta+a');
    }
    await owner.page.getByRole('button', { name: 'In đậm', exact: true }).click();
    await guest.page.getByRole('button', { name: 'In nghiêng', exact: true }).click();
    await owner.context.setOffline(false);
    await guest.context.setOffline(false);
    for (const user of [owner, guest]) {
      await user.page.waitForFunction(() =>
        [...document.querySelectorAll('.cm-line span')].some((span) => {
          const style = getComputedStyle(span);
          return Number(style.fontWeight) >= 700 && style.fontStyle === 'italic';
        }),
      );
    }
    console.log('check: extended formatting across real peers');
    await owner.context.setOffline(true);
    await guest.context.setOffline(true);
    await owner.page.getByRole('button', { name: 'Tô nền chữ', exact: true }).click();
    await guest.page.getByRole('button', { name: 'Gạch ngang', exact: true }).click();
    await guest.page.getByRole('button', { name: 'Chỉ số dưới', exact: true }).click();
    await owner.context.setOffline(false);
    await guest.context.setOffline(false);
    for (const user of [owner, guest])
      await user.page.waitForFunction(() =>
        [...document.querySelectorAll('.cm-line span')].some((span) => {
          const css = getComputedStyle(span);
          return (
            css.backgroundColor === 'rgb(255, 255, 0)' &&
            css.textDecorationLine.includes('line-through') &&
            css.verticalAlign === 'sub'
          );
        }),
      );
    await owner.page.locator('.cm-content').click();
    await owner.page.keyboard.press('ControlOrMeta+End');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      'base64',
    );
    await owner.page
      .locator('input[aria-label="Chọn ảnh PNG hoặc JPEG"]')
      .setInputFiles({ name: 'collaboration.png', mimeType: 'image/png', buffer: png });
    await guest.page.locator('.editor-inline-image').waitFor();
    const merged = await converge(
      owner.page,
      guest.page,
      (text) => text.includes('Alice') && text.includes('Bob'),
    );

    // Competing native checkpoints may return 423; the loser retains its draft.
    await owner.page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await owner.page.getByText('Đã lưu', { exact: true }).waitFor({ timeout: 30000 });
    const saved = await api(owner, `/api/v1/documents/${document.id}`);
    assert.ok(saved.headRevision > 0);
    await owner.page.reload();
    await owner.page.getByRole('button', { name: title, exact: true }).last().click();
    await owner.page.locator('.editor-inline-image').waitFor();
    assert.equal(await editorText(owner.page), merged);
    await owner.page.getByRole('button', { name: 'Cùng chỉnh sửa', exact: true }).click();
    await owner.page.getByRole('button', { name: 'Đã đồng bộ cộng tác', exact: true }).waitFor();

    console.log('check: same-account tabs and offline journal recovery');
    const secondTab = await owner.context.newPage();
    await secondTab.goto(base);
    await secondTab.getByRole('button', { name: title, exact: true }).last().click();
    await secondTab.getByRole('button', { name: 'Cùng chỉnh sửa', exact: true }).click();
    await secondTab.getByRole('button', { name: 'Đã đồng bộ cộng tác', exact: true }).waitFor();
    await owner.context.setOffline(true);
    await typeEnd(owner.page, ' tab-one');
    await typeEnd(secondTab, ' tab-two');
    await owner.page.waitForFunction(
      (room) =>
        new Promise((resolve) => {
          const open = indexedDB.open('ted-collaboration', 2);
          open.onsuccess = () => {
            const db = open.result;
            const get = db.transaction('updates').objectStore('updates').index('room').getAll(room);
            get.onsuccess = () => {
              resolve(get.result.length >= 2);
              db.close();
            };
          };
        }),
      `${owner.user.id}:${document.id}`,
    );
    await owner.page.close();
    await secondTab.close();
    await owner.context.setOffline(false);
    owner.page = await owner.context.newPage();
    await owner.page.goto(base);
    await owner.page.getByRole('button', { name: title, exact: true }).last().click();
    await owner.page.getByRole('button', { name: 'Cùng chỉnh sửa', exact: true }).click();
    await converge(
      owner.page,
      guest.page,
      (text) => text.includes('tab-one') && text.includes('tab-two'),
    );

    console.log('check: restart');
    execFileSync(
      'docker',
      [
        'compose',
        '--env-file',
        '.env',
        '-f',
        'infra/compose/compose.yaml',
        'restart',
        'collaboration-service',
      ],
      { stdio: 'ignore', timeout: 60000 },
    );
    await typeEnd(owner.page, ' persisted');
    await converge(owner.page, guest.page, (text) => text.includes('persisted'));

    await api(owner, `/api/v1/documents/${document.id}/permissions/${guest.user.id}`, 'PUT', {
      role: 'VIEWER',
    });
    const denied = await fetch(
      `${base}/api/v1/collaboration/${document.id}/updates/00000000-0000-0000-0000-000000000001`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${guest.token}`,
          'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array([0]),
      },
    );
    assert.equal(denied.status, 403);
    await api(
      owner,
      `/api/v1/documents/${document.id}/permissions/${guest.user.id}`,
      'DELETE',
      undefined,
      204,
    );
    await api(guest, `/api/v1/collaboration/${document.id}/updates?after=0`, 'GET', undefined, 404);
    const anonymous = await fetch(`${base}/api/v1/collaboration/${document.id}/updates?after=0`);
    assert.equal(anonymous.status, 401);
    console.log(
      'PASS: two-user offline concurrent edits, selective undo/redo, formatting, shared image, native save/reopen, same-account tab journal recovery, restart, viewer denial, revocation and anonymous denial',
    );
  } finally {
    if (owner && document) {
      const current = await api(owner, `/api/v1/documents/${document.id}`);
      await api(
        owner,
        `/api/v1/documents/${document.id}`,
        'DELETE',
        { expectedMetadataRevision: current.metadataRevision },
        204,
      );
    }
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
