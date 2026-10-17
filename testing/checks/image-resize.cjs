const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');

module.exports = async function imageResize(page, upload, download, reports) {
  const buffer = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 60;
    const context = canvas.getContext('2d');
    context.fillStyle = '#3264d9';
    context.fillRect(0, 0, 120, 60);
    return Array.from(atob(canvas.toDataURL().split(',')[1]), (c) => c.charCodeAt(0));
  });
  const rich = page.locator('#local-document .cm-content');
  await rich.press('Control+Home');
  await page.getByLabel('Chọn ảnh PNG hoặc JPEG', { exact: true }).setInputFiles({
    name: 'resize.png',
    mimeType: 'image/png',
    buffer: Buffer.from(buffer),
  });
  const image = page.locator('#local-document img.editor-inline-image');
  await expect(image).toHaveAttribute('width', '120');
  await image.click();
  const tools = page.getByRole('complementary', { name: 'Kích thước ảnh' });
  await tools.getByLabel('Rộng (px)').fill('80');
  await expect(tools.getByLabel('Cao (px)')).toHaveValue('40');
  await tools.getByRole('button', { name: 'Áp dụng', exact: true }).click();
  await expect(image).toHaveAttribute('width', '80');
  await expect(image).toHaveAttribute('height', '40');
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
  await expect(image).toHaveAttribute('width', '120');
  await page.getByRole('button', { name: 'Làm lại', exact: true }).click();
  await expect(image).toHaveAttribute('width', '80');
  await image.click();
  await tools.getByLabel('Giữ tỉ lệ').uncheck();
  await tools.getByLabel('Cao (px)').fill('50');
  await tools.getByRole('button', { name: 'Áp dụng', exact: true }).click();
  await expect(image).toHaveAttribute('height', '50');
  await page.setViewportSize({ width: 390, height: 844 });
  await image.click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${reports}/image-size-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const menu = page.locator('#local-document .editor-heading-actions details');
  await menu.locator('summary').click();
  const bytes = await download(
    menu.getByRole('button', { name: 'Tải bản native', exact: true }),
    'resized-image.tedoc',
  );
  const media = JSON.parse(strFromU8(unzipSync(bytes)['media.json']));
  assert.equal(media.images[0].width, 80);
  assert.equal(media.images[0].height, 50);
  await upload({
    name: 'roundtrip.docx.tedoc',
    mimeType: 'application/octet-stream',
    buffer: bytes,
  });
  await expect(image).toHaveAttribute('width', '80');
  await expect(image).toHaveAttribute('height', '50');
  await image.click();
  await tools.getByLabel('Rộng (px)').fill('4097');
  await expect(tools.getByRole('button', { name: 'Áp dụng', exact: true })).toBeDisabled();
  await page.screenshot({ path: `${reports}/image-size-desktop.png`, fullPage: true });
  const cell = page.locator('#local-document td').last();
  await cell.click();
  await page.getByLabel('Chọn ảnh PNG hoặc JPEG', { exact: true }).setInputFiles({
    name: 'table-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from(buffer),
  });
  const tableImage = cell.locator('img');
  await expect(tableImage).toHaveAttribute('width', '120');
  await tableImage.click();
  await expect(tools.getByLabel('Rộng (px)')).toHaveValue('120');
  await tools.getByLabel('Rộng (px)').fill('60');
  await tools.getByRole('button', { name: 'Áp dụng', exact: true }).click();
  await expect(tableImage).toHaveAttribute('width', '60');
  await expect(tableImage).toHaveAttribute('height', '30');
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
  await expect(tableImage).toHaveAttribute('width', '120');
};
