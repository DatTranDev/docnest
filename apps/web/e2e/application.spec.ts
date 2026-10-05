import { expect, test, type Page } from '@playwright/test';
import { loginSession as register } from './auth-support';
const ownerEmail = process.env.E2E_OWNER_EMAIL ?? 'e2e-owner@example.test',
  editorEmail = process.env.E2E_EDITOR_EMAIL ?? 'e2e-editor@example.test';
async function expectTxt(page: Page, text: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Tải TXT', exact: true }).click();
  const stream = await (await pending).createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString('utf8')).toBe(text);
}

test('two real accounts: save/reopen, folders, sharing, revoke, conflict, versions, exports and refresh', async ({
  browser,
}) => {
  const suffix = Date.now(),
    alice = await browser.newContext(),
    bob = await browser.newContext(),
    a = await alice.newPage(),
    b = await bob.newPage(),
    emailA = ownerEmail,
    emailB = editorEmail,
    folderName = `Project ${suffix}`,
    docName = `Draft ${suffix}`;
  await register(a, emailA, 'Alice');
  await register(b, emailB, 'Bob');
  a.once('dialog', (d) => d.accept(folderName));
  await a.getByRole('button', { name: 'Thư mục mới', exact: true }).click();
  await a.getByRole('button', { name: `📁 ${folderName}`, exact: true }).click();
  a.once('dialog', (d) => d.accept(docName));
  await a.getByRole('button', { name: 'Tài liệu mới', exact: true }).click();
  const editor = a.locator('.cm-content');
  await editor.click();
  await editor.pressSequentially('Hello Việt 😀');
  await editor.press('Control+a');
  await a.getByRole('button', { name: 'In đậm', exact: true }).click();
  await a.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(a.getByRole('status')).toHaveText('Đã lưu');
  await a.getByRole('button', { name: `📄 ${docName}`, exact: true }).click();
  await expect(editor).toHaveText('Hello Việt 😀');
  await expect(a.locator('.cm-content .style-1').first()).toBeVisible();
  await expect(a.getByLabel(`Bản xem trước ${docName}`, { exact: true })).toContainText(
    'Hello Việt 😀',
    { timeout: 20000 },
  );
  await a.reload();
  await expect(a.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible();
  await a.getByRole('button', { name: `📁 ${folderName}`, exact: true }).click();
  await a.getByRole('button', { name: `📄 ${docName}`, exact: true }).click();
  await a.getByRole('button', { name: 'Chia sẻ', exact: true }).click();
  await a.getByLabel('Email người nhận').fill(emailB);
  await a.getByRole('button', { name: 'Cấp quyền', exact: true }).click();
  await expect(a.getByText(emailB, { exact: true })).toBeVisible();
  await a.getByRole('button', { name: 'Tạo liên kết 7 ngày', exact: true }).click();
  const publicUrl = await a.getByLabel('Liên kết công khai').inputValue();
  const publicContext = await browser.newContext(),
    p = await publicContext.newPage();
  await p.goto(publicUrl);
  await expect(p.locator('.cm-content')).toHaveText('Hello Việt 😀');
  await expect(p.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await a.getByRole('button', { name: 'Đóng', exact: true }).click();
  await b.getByRole('button', { name: 'Được chia sẻ', exact: true }).click();
  await b.getByRole('button', { name: `📄 ${docName}`, exact: true }).click();
  await expect(b.getByRole('button', { name: 'Lưu', exact: true })).toBeDisabled();
  await b.locator('.cm-content').click();
  await b.locator('.cm-content').press('Control+a');
  await b.locator('.cm-content').press('Control+b');
  await expect(b.getByRole('status')).toHaveText('Đã lưu');
  await expect(b.locator('.cm-content .style-1').first()).toBeVisible();
  await a.getByRole('button', { name: 'Chia sẻ', exact: true }).click();
  await a.getByLabel(`Quyền ${emailB}`).selectOption('EDITOR');
  await a.getByRole('button', { name: 'Đóng', exact: true }).click();
  await b.getByRole('button', { name: `📄 ${docName}`, exact: true }).click();
  await expect(b.getByRole('button', { name: 'Lưu', exact: true })).toBeEnabled();
  await editor.click();
  await editor.press('Control+End');
  await editor.pressSequentially(' Alice');
  await b.locator('.cm-content').click();
  await b.locator('.cm-content').press('Control+End');
  await b.locator('.cm-content').pressSequentially(' Bob');
  await a.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(a.getByRole('status')).toHaveText('Đã lưu');
  await b.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(b.getByRole('status')).toHaveText('Xung đột');
  await expect(b.locator('.cm-content')).toContainText(' Bob');
  await b.reload();
  await b.getByRole('button', { name: 'Được chia sẻ', exact: true }).click();
  await b.getByRole('button', { name: `📄 ${docName}`, exact: true }).click();
  await b.getByRole('button', { name: 'Khôi phục bản nháp', exact: true }).click();
  await expect(b.getByRole('status')).toHaveText('Xung đột');
  await expect(b.locator('.cm-content')).toContainText(' Bob');
  await a.getByRole('button', { name: 'Xuất HTML', exact: true }).click();
  await expect(a.getByRole('button', { name: 'Tải kết quả', exact: true })).toBeVisible({
    timeout: 90000,
  });
  await a.getByRole('button', { name: 'Lịch sử', exact: true }).click();
  await expect(
    a
      .getByRole('dialog', { name: 'Lịch sử phiên bản' })
      .getByRole('button', { name: 'Mở chỉ đọc' }),
  ).toHaveCount(2);
  await a.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  await a.getByRole('button', { name: 'Chia sẻ', exact: true }).click();
  await a.getByRole('button', { name: 'Thu hồi', exact: true }).click();
  await a.getByRole('button', { name: 'Thu hồi liên kết', exact: true }).click();
  await a.getByRole('button', { name: 'Đóng', exact: true }).click();
  await p.reload();
  await expect(p.getByRole('alert').filter({ hasText: 'Liên kết không hợp lệ' })).toBeVisible();
  await b.getByRole('button', { name: 'Được chia sẻ', exact: true }).click();
  await b.reload();
  await b.getByRole('button', { name: 'Được chia sẻ', exact: true }).click();
  await expect(b.getByRole('button', { name: `📄 ${docName}`, exact: true })).toHaveCount(0);
  await a.getByRole('button', { name: 'Bỏ vào thùng rác', exact: true }).click();
  await a.getByRole('button', { name: 'Thùng rác', exact: true }).click();
  await a
    .getByRole('button', { name: `📄 ${docName}`, exact: true })
    .locator('..')
    .getByRole('button', { name: 'Khôi phục', exact: true })
    .click();
  await a.getByRole('button', { name: 'Tài liệu của tôi', exact: true }).click();
  await a.getByRole('button', { name: `📁 ${folderName}`, exact: true }).click();
  await expect(a.getByRole('button', { name: `📄 ${docName}`, exact: true })).toBeVisible();
  await alice.close();
  await bob.close();
  await publicContext.close();
});
test('offline draft survives reload without automatic cloud overwrite', async ({ browser }) => {
  const context = await browser.newContext(),
    p = await context.newPage();
  await register(p, process.env.E2E_RECOVERY_EMAIL ?? 'e2e-recovery@example.test', 'Recovery');
  const title = `Offline ${Date.now()}`;
  p.once('dialog', (d) => d.accept(title));
  await p.getByRole('button', { name: 'Tài liệu mới', exact: true }).click();
  await p.locator('.cm-content').click();
  await p.locator('.cm-content').pressSequentially('Cloud');
  await p.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(p.getByRole('status')).toHaveText('Đã lưu');
  await context.setOffline(true);
  await p.locator('.cm-content').press('Control+End');
  await p.locator('.cm-content').pressSequentially(' draft');
  await expect(p.getByRole('status')).toHaveText('Ngoại tuyến');
  await p.waitForTimeout(3500);
  await context.setOffline(false);
  await p.reload();
  await p.getByRole('button', { name: `📄 ${title}`, exact: true }).click();
  await p.getByRole('button', { name: 'Khôi phục bản nháp', exact: true }).click();
  await expect(p.locator('.cm-content')).toHaveText('Cloud draft');
  await expect(p.getByRole('status')).toHaveText('Chưa lưu');
  await context.close();
});
test('actual IndexedDB quota failure warns and preserves the dirty editor', async ({ browser }) => {
  const context = await browser.newContext(),
    p = await context.newPage();
  await register(p, process.env.E2E_QUOTA_EMAIL ?? 'e2e-quota@example.test', 'Quota');
  p.once('dialog', (d) => d.accept(`Quota ${Date.now()}`));
  await p.getByRole('button', { name: 'Tài liệu mới', exact: true }).click();
  const cdp = await context.newCDPSession(p);
  await cdp.send('Storage.overrideQuotaForOrigin', {
    origin: new URL(p.url()).origin,
    quotaSize: 2048,
  });
  await p.getByLabel('Nhập tệp', { exact: true }).setInputFiles({
    name: 'quota.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('x'.repeat(65536)),
  });
  await expect(
    p.getByRole('alert').filter({ hasText: 'Không thể khôi phục bản nháp' }),
  ).toBeVisible({
    timeout: 10000,
  });
  await expect(p.getByRole('status')).toHaveText('Chưa lưu');
  await expect(p.locator('.cm-content')).toContainText('x'.repeat(100));
  await context.close();
});

test('saving snapshot R while typing R+1 keeps the newer text unsaved', async ({ browser }) => {
  const context = await browser.newContext(),
    p = await context.newPage();
  await register(p, ownerEmail, 'Alice');
  const title = `Snapshot ${Date.now()}`;
  p.once('dialog', (d) => d.accept(title));
  await p.getByRole('button', { name: 'Tài liệu mới', exact: true }).click();
  const editor = p.locator('.cm-content');
  await editor.click();
  await editor.pressSequentially('R');
  let release!: () => void, reached!: () => void;
  const wait = new Promise<void>((r) => (release = r)),
    commit = new Promise<void>((r) => (reached = r));
  await p.route('**/api/v1/documents/*/versions', async (route) => {
    if (route.request().method() === 'POST') {
      reached();
      await wait;
    }
    await route.continue();
  });
  await p.getByRole('button', { name: 'Lưu', exact: true }).click();
  await commit;
  await editor.click();
  await editor.press('Control+End');
  await editor.pressSequentially('+1');
  release();
  await expect(p.getByRole('status')).toHaveText('Chưa lưu');
  await expect(editor).toHaveText('R+1');
  await p.unroute('**/api/v1/documents/*/versions');
  await p.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(p.getByRole('status')).toHaveText('Đã lưu');
  await p.getByRole('button', { name: `📄 ${title}`, exact: true }).click();
  await expect(editor).toHaveText('R+1');
  await context.close();
});

test('formatting, fresh case-folded replacement, bulk undo and offline checkpoint reopen', async ({
  browser,
}) => {
  const context = await browser.newContext(),
    p = await context.newPage(),
    errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await register(p, ownerEmail, 'Alice');
  const title = `Replace ${Date.now()}`;
  p.once('dialog', (d) => d.accept(title));
  await p.getByRole('button', { name: 'Tài liệu mới', exact: true }).click();
  const editor = p.locator('.cm-content');
  await editor.click();
  await editor.pressSequentially('Ab aB');
  await editor.press('Control+a');
  for (const label of ['In đậm', 'In nghiêng', 'Gạch chân'])
    await p.getByRole('button', { name: label, exact: true }).click();
  await expect(editor.locator('.style-7')).toHaveText('Ab aB');
  await p.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
  await expect(editor.locator('.style-3')).toHaveText('Ab aB');
  await p.getByRole('button', { name: 'Làm lại', exact: true }).click();
  await expect(editor.locator('.style-7')).toHaveText('Ab aB');
  await p.getByLabel('Tìm kiếm', { exact: true }).fill('Ab');
  await p.getByRole('button', { name: 'Tìm', exact: true }).click();
  await expect(p.getByText('1 kết quả', { exact: true })).toBeVisible();
  await p.getByLabel('Tìm kiếm', { exact: true }).fill('AB');
  await p.getByLabel('Bỏ qua hoa/thường ASCII').check();
  await p.getByLabel('Thay thế', { exact: true }).fill('xy');
  await p.getByRole('button', { name: 'Thay tất cả', exact: true }).click();
  await expect(editor).toHaveText('xy xy');
  await expect(editor.locator('.style-7')).toHaveText('xy xy');
  await p.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
  await expect(editor).toHaveText('Ab aB');
  await p.getByRole('button', { name: 'Làm lại', exact: true }).click();
  await p.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(p.getByRole('status')).toHaveText('Đã lưu');
  await p.getByRole('button', { name: `📄 ${title}`, exact: true }).click();
  await expect(p.getByRole('status')).toHaveText('Đã lưu');
  await expect(editor.locator('.style-7')).toHaveText('xy xy');
  const original = 'ab'.repeat(12000),
    replaced = 'zb'.repeat(12000);
  await p
    .getByLabel('Nhập tệp', { exact: true })
    .setInputFiles({ name: 'bulk.txt', mimeType: 'text/plain', buffer: Buffer.from(original) });
  await expect(p.getByRole('status')).toHaveText('Chưa lưu');
  await expectTxt(p, original);
  await p.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(p.getByRole('status')).toHaveText('Đã lưu');
  await context.setOffline(true);
  await p.getByLabel('Tìm kiếm', { exact: true }).fill('a');
  await p.getByLabel('Thay thế', { exact: true }).fill('z');
  await p.getByRole('button', { name: 'Thay tất cả', exact: true }).click();
  await expectTxt(p, replaced);
  await p.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
  await expectTxt(p, original);
  await p.getByRole('button', { name: 'Làm lại', exact: true }).click();
  await expectTxt(p, replaced);
  await p.waitForTimeout(3500);
  await context.setOffline(false);
  await p.reload();
  await p.getByRole('button', { name: `📄 ${title}`, exact: true }).click();
  await p.getByRole('button', { name: 'Khôi phục bản nháp', exact: true }).click();
  await expect(p.getByRole('status')).toHaveText('Chưa lưu');
  await expectTxt(p, replaced);
  await p.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(p.getByRole('status')).toHaveText('Đã lưu');
  p.once('dialog', (d) => d.accept());
  await p.getByRole('button', { name: 'Xóa lịch sử hoàn tác', exact: true }).click();
  await p.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
  await expectTxt(p, replaced);
  await p.getByRole('button', { name: `📄 ${title}`, exact: true }).click();
  await expectTxt(p, replaced);
  expect(errors).toEqual([]);
  await context.close();
});

test('a delayed real Owned response cannot overwrite the selected Trash view', async ({
  browser,
}) => {
  const context = await browser.newContext(),
    p = await context.newPage();
  await register(p, ownerEmail, 'Alice');
  const title = `List race ${Date.now()}`;
  p.once('dialog', (d) => d.accept(title));
  await p.getByRole('button', { name: 'Tài liệu mới', exact: true }).click();
  const file = p.getByRole('button', { name: `📄 ${title}`, exact: true });
  await file.locator('..').getByRole('button', { name: 'Bỏ vào thùng rác', exact: true }).click();
  await p.getByRole('button', { name: 'Thùng rác', exact: true }).click();
  await expect(file).toBeVisible();
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    captured = new Promise<void>((r) => (reached = r));
  let held = false;
  await p.route('**/api/v1/documents?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('scope') === 'OWNED' && !held) {
      held = true;
      const response = await route.fetch();
      reached();
      await gate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await p.getByRole('button', { name: 'Tài liệu của tôi', exact: true }).click();
  await captured;
  const trash = p.waitForResponse(
    (r) =>
      r.url().includes('/api/v1/documents?') &&
      new URL(r.url()).searchParams.get('scope') === 'TRASH',
  );
  await p.getByRole('button', { name: 'Thùng rác', exact: true }).click();
  await trash;
  await expect(file).toBeVisible();
  release();
  await p.waitForTimeout(250);
  await expect(p.getByRole('heading', { name: 'Thùng rác', exact: true })).toBeVisible();
  await expect(file).toBeVisible();
  await context.close();
});

test('latest document selection wins when the preceding real native read finishes late', async ({
  browser,
}) => {
  const context = await browser.newContext(),
    p = await context.newPage();
  await register(p, ownerEmail, 'Alice');
  const names = [`Older open ${Date.now()}`, `Newer open ${Date.now()}`],
    editor = p.locator('.cm-content');
  for (const [name, text] of names.map((name, i) => [name, i ? 'latest' : 'older'])) {
    p.once('dialog', (d) => d.accept(name!));
    await p.getByRole('button', { name: 'Tài liệu mới', exact: true }).click();
    await editor.click();
    await editor.pressSequentially(text!);
    await p.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(p.getByRole('status')).toHaveText('Đã lưu');
  }
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    captured = new Promise<void>((r) => (reached = r));
  let held = false;
  await p.route('**/api/v1/documents/*/versions/*/content', async (route) => {
    if (!held) {
      held = true;
      const response = await route.fetch();
      reached();
      await gate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await p.getByRole('button', { name: `📄 ${names[0]}`, exact: true }).click();
  await captured;
  await p.getByRole('button', { name: `📄 ${names[1]}`, exact: true }).click();
  await expect(p.getByRole('status')).toHaveText('Đã lưu');
  await expect(editor).toHaveText('latest');
  release();
  await p.waitForTimeout(250);
  await expect(editor).toHaveText('latest');
  await expect(p.locator('.editor-section h2')).toHaveText(names[1]!);
  await context.close();
});
