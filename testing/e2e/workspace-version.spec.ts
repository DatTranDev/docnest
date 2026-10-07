import { expect, test, type Page } from '@playwright/test';
import { loginSession as login } from './auth-support';
const ownerEmail = process.env.E2E_OWNER_EMAIL ?? 'e2e-owner@example.test',
  editorEmail = process.env.E2E_EDITOR_EMAIL ?? 'e2e-editor@example.test';
function folderRow(page: Page, name: string) {
  return page
    .locator('.file')
    .filter({ has: page.getByRole('button', { name: `📁 ${name}`, exact: true }) });
}
function docRow(page: Page, name: string) {
  return page
    .locator('.file')
    .filter({ has: page.getByRole('button', { name: `📄 ${name}`, exact: true }) });
}
async function createFolder(page: Page, name: string) {
  page.once('dialog', (d) => d.accept(name));
  await page.getByRole('button', { name: 'Thư mục mới', exact: true }).click();
  await expect(folderRow(page, name)).toBeVisible();
}
async function move(page: Page, kind: 'folder' | 'document', name: string, destination: string) {
  const row = kind === 'folder' ? folderRow(page, name) : docRow(page, name);
  await row.getByRole('button', { name: 'Di chuyển', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Di chuyển', exact: true });
  await dialog.getByLabel('Thư mục đích').selectOption({ label: destination });
  const patched = page.waitForResponse(
    (r) =>
      r.request().method() === 'PATCH' &&
      r.url().includes(`/api/v1/${kind === 'folder' ? 'folders' : 'documents'}/`),
  );
  await dialog.getByRole('button', { name: 'Di chuyển', exact: true }).click();
  expect((await patched).status()).toBe(200);
  await expect(row).toHaveCount(0);
}

test('two accounts organize files, attribute an editor commit, open an old version and fork a formatted owned copy', async ({
  browser,
}) => {
  const suffix = Date.now(),
    alice = await browser.newContext(),
    bob = await browser.newContext(),
    a = await alice.newPage(),
    b = await bob.newPage();
  await login(a, ownerEmail, 'Alice');
  const bobId = await login(b, editorEmail, 'Bob');
  const source = `Source ${suffix}`,
    renamedSource = `Renamed source ${suffix}`,
    destination = `Destination ${suffix}`,
    initialTitle = `Original ${suffix}`,
    title = `Renamed document ${suffix}`,
    copyTitle = `Bob copy ${suffix}`;
  await createFolder(a, source);
  await createFolder(a, destination);
  a.once('dialog', (d) => d.accept(renamedSource));
  await folderRow(a, source).getByRole('button', { name: 'Đổi tên', exact: true }).click();
  await expect(folderRow(a, renamedSource)).toBeVisible();
  await a.getByRole('button', { name: `📁 ${renamedSource}`, exact: true }).click();
  a.once('dialog', (d) => d.accept(initialTitle));
  await a.getByRole('button', { name: 'Tài liệu mới', exact: true }).click();
  await expect(docRow(a, initialTitle)).toBeVisible();
  a.once('dialog', (d) => d.accept(title));
  await docRow(a, initialTitle).getByRole('button', { name: 'Đổi tên', exact: true }).click();
  await expect(docRow(a, title)).toBeVisible();
  await move(a, 'document', title, destination);
  await a
    .getByRole('navigation', { name: 'Đường dẫn' })
    .getByRole('button', { name: 'Gốc', exact: true })
    .click();
  await expect(folderRow(a, renamedSource)).toBeVisible();
  await move(a, 'folder', renamedSource, destination);
  await a.getByRole('button', { name: `📁 ${destination}`, exact: true }).click();
  await expect(folderRow(a, renamedSource)).toBeVisible();
  const deleted = a.waitForResponse(
    (r) => r.request().method() === 'DELETE' && r.url().includes('/api/v1/folders/'),
  );
  await folderRow(a, renamedSource).getByRole('button', { name: 'Xóa', exact: true }).click();
  expect((await deleted).status()).toBe(204);
  await expect(folderRow(a, renamedSource)).toHaveCount(0);
  await a.getByRole('button', { name: `📄 ${title}`, exact: true }).click();
  const original = 'Version one Việt 😀',
    ownerEditor = a.locator('.cm-content');
  await ownerEditor.click();
  await ownerEditor.pressSequentially(original);
  await ownerEditor.press('Control+a');
  await a.getByRole('button', { name: 'In đậm', exact: true }).click();
  await a.getByRole('button', { name: 'In nghiêng', exact: true }).click();
  await a.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(a.getByRole('status')).toHaveText('Đã lưu');
  await a.getByRole('button', { name: 'Chia sẻ', exact: true }).click();
  await a.getByLabel('Email người nhận').fill(editorEmail);
  await a.getByLabel('Quyền', { exact: true }).selectOption('EDITOR');
  await a.getByRole('button', { name: 'Cấp quyền', exact: true }).click();
  await expect(a.getByText(editorEmail, { exact: true })).toBeVisible();
  await a.getByRole('button', { name: 'Đóng', exact: true }).click();
  await b.getByRole('button', { name: 'Được chia sẻ', exact: true }).click();
  await b.getByRole('button', { name: `📄 ${title}`, exact: true }).click();
  await expect(docRow(b, title).getByRole('button', { name: 'Đổi tên', exact: true })).toHaveCount(
    0,
  );
  await expect(b.getByRole('button', { name: 'Chia sẻ', exact: true })).toHaveCount(0);
  const editor = b.locator('.cm-content');
  await editor.click();
  await editor.press('Control+End');
  await editor.pressSequentially(' Bob');
  const committed = b.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      /\/api\/v1\/documents\/[^/]+\/versions$/.test(new URL(r.url()).pathname),
  );
  await b.getByRole('button', { name: 'Lưu', exact: true }).click();
  const result = await committed;
  expect(result.status()).toBe(201);
  const version = (await result.json()).version;
  expect(version.createdByUserId).toBe(bobId);
  expect(version.revision).toBe(2);
  await expect(b.getByRole('status')).toHaveText('Đã lưu');
  await b.getByRole('button', { name: 'Lịch sử', exact: true }).click();
  await b
    .getByRole('dialog', { name: 'Lịch sử phiên bản' })
    .locator('.row')
    .filter({ hasText: 'Phiên bản 1 ·' })
    .getByRole('button', { name: 'Mở chỉ đọc', exact: true })
    .click();
  await expect(editor).toHaveText(original);
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await expect(b.getByRole('button', { name: 'Lưu', exact: true })).toBeDisabled();
  await expect(editor.locator('.style-3')).toHaveText(original);
  b.once('dialog', (d) => d.accept(copyTitle));
  const copied = b.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/documents',
  );
  await b.getByRole('button', { name: 'Lưu bản sao', exact: true }).click();
  const copy = await (await copied).json();
  expect(copy.ownerUserId).toBe(bobId);
  expect(copy.effectiveRole).toBe('OWNER');
  await expect(b.getByRole('button', { name: 'Lưu', exact: true })).toBeEnabled();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor.locator('.style-3')).toHaveText(original);
  await b.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(b.getByRole('status')).toHaveText('Đã lưu');
  await b.getByRole('button', { name: 'Tài liệu của tôi', exact: true }).click();
  await b.getByRole('button', { name: `📄 ${copyTitle}`, exact: true }).click();
  await expect(editor).toHaveText(original);
  await expect(editor.locator('.style-3')).toHaveText(original);
  await expect(docRow(b, copyTitle).locator('.badge')).toHaveText('OWNER');
  await alice.close();
  await bob.close();
});
