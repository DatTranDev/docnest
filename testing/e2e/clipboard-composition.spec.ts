import { expect, test, type Page } from '@playwright/test';
import { loginSession } from './auth-support';
async function openDocument(page: Page, label: string) {
  await loginSession(page, process.env.E2E_OWNER_EMAIL ?? 'e2e-owner@example.test', 'Alice');
  page.once('dialog', (d) => d.accept(`${label} ${Date.now()}`));
  await page.getByRole('button', { name: 'Tài liệu mới', exact: true }).click();
  return page.locator('.cm-content');
}

test('real clipboard copy/cut preserves mixed styles and external text normalizes line endings', async ({
  browser,
}) => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] }),
    page = await context.newPage(),
    editor = await openDocument(page, 'Clipboard');
  await editor.click();
  await editor.pressSequentially('Bold');
  await editor.press('Control+a');
  await page.getByRole('button', { name: 'In đậm', exact: true }).click();
  await editor.press('Control+End');
  await editor.press('Control+b');
  await editor.pressSequentially(' plain');
  await editor.press('Control+a');
  await editor.press('Control+c');
  await editor.press('Control+End');
  await editor.press('Control+v');
  await expect(editor).toHaveText('Bold plainBold plain');
  await expect(editor.locator('.style-1')).toHaveText(['Bold', 'Bold']);
  for (let i = 0; i < 10; i++) await editor.press('Shift+ArrowLeft');
  await editor.press('Control+x');
  await expect(editor).toHaveText('Bold plain');
  await editor.press('Control+z');
  await expect(editor).toHaveText('Bold plainBold plain');
  await expect(editor.locator('.style-1')).toHaveText(['Bold', 'Bold']);
  await editor.press('Control+Shift+z');
  await expect(editor).toHaveText('Bold plain');
  await editor.press('Control+End');
  await page.evaluate(() => navigator.clipboard.writeText('\r\nViệt 😀'));
  await editor.press('Control+v');
  await expect(editor.locator('.cm-line')).toHaveText(['Bold plain', 'Việt 😀']);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', ' literal');
    data.setData('application/x-ted-text-style-v1', '{"version":1,"text":"!!!!","styles":"!!!!"}');
    document
      .querySelector('.cm-content')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
  });
  await expect(editor.locator('.cm-line')).toHaveText(['Bold plain', 'Việt 😀 literal']);
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Đã lưu');
  await context.close();
});

test('browser IME composition lasting longer than typing debounce undoes as one action', async ({
  browser,
}) => {
  const context = await browser.newContext(),
    page = await context.newPage(),
    editor = await openDocument(page, 'Composition');
  await editor.click();
  await editor.pressSequentially('A');
  await page.getByRole('button', { name: 'In nghiêng', exact: true }).click();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'v', selectionStart: 1, selectionEnd: 1 });
  await page.waitForTimeout(650);
  await cdp.send('Input.imeSetComposition', { text: 'vie', selectionStart: 3, selectionEnd: 3 });
  await page.waitForTimeout(650);
  await cdp.send('Input.insertText', { text: 'Việt' });
  await expect(editor).toHaveText('AViệt');
  await expect(editor.locator('.style-2')).toHaveText('Việt');
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
  await expect(editor).toHaveText('A');
  await page.getByRole('button', { name: 'Làm lại', exact: true }).click();
  await expect(editor).toHaveText('AViệt');
  await expect(editor.locator('.style-2')).toHaveText('Việt');
  await context.close();
});
