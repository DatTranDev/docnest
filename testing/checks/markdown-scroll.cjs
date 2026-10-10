const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');

/** Exercise actual pane geometry on compiled assets, including unequal Markdown/rendered heights. */
module.exports = async function markdownScroll(page, upload) {
  const sections = Array.from(
    { length: 70 },
    (_, index) =>
      `## Section ${index}\n\n${'A paragraph that wraps in preview but occupies one source line. '.repeat(index % 3 ? 5 : 18)}\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| ${index} | table |\n\n\`\`\`js\nconst section = ${index};\nconsole.log(section);\n\`\`\`\n\n`,
  ).join('');
  await upload({ name: 'scroll.md', mimeType: 'text/markdown', buffer: Buffer.from(sections) });
  const source = page.locator('#local-markdown .cm-scroller');
  const preview = page.locator('#local-markdown .preview-pane');
  await expect(preview.locator('h2')).toHaveCount(70);
  const label = page.locator('#local-markdown .preview-column > .pane-label');
  const labelTop = await label.evaluate((node) => node.getBoundingClientRect().top);
  const heading = (index) =>
    preview.getByRole('heading', { name: `Section ${index}`, exact: true });
  async function previewDistance(index) {
    return heading(index).evaluate(
      (node) =>
        node.getBoundingClientRect().top -
        node.closest('.preview-pane').getBoundingClientRect().top,
    );
  }
  async function sourceDistance(index) {
    return page
      .locator('#local-markdown .cm-line')
      .filter({ hasText: `## Section ${index}` })
      .evaluate(
        (node) =>
          node.getBoundingClientRect().top -
          node.closest('.cm-scroller').getBoundingClientRect().top,
      );
  }
  async function fromSource(index) {
    const line = Number(await heading(index).getAttribute('data-source-line'));
    await source.evaluate((node, line) => {
      const content = node.querySelector('.cm-content'),
        style = getComputedStyle(content);
      node.scrollTop = (line - 1) * parseFloat(style.lineHeight) + parseFloat(style.paddingTop);
    }, line);
    await expect.poll(async () => Math.abs(await previewDistance(index))).toBeLessThan(3);
    await expect.poll(async () => Math.abs(await sourceDistance(index))).toBeLessThan(3);
  }
  async function fromPreview(index) {
    await heading(index).evaluate((node) => {
      const pane = node.closest('.preview-pane');
      pane.scrollTop += node.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    });
    await expect.poll(async () => Math.abs(await sourceDistance(index))).toBeLessThan(3);
    await expect.poll(async () => Math.abs(await previewDistance(index))).toBeLessThan(3);
  }
  await fromSource(20);
  await fromPreview(45);
  assert.ok(
    Math.abs((await label.evaluate((node) => node.getBoundingClientRect().top)) - labelTop) < 1,
  );
  await expect(label).toHaveText('Xem trước');
  // Scroll events settle without a loop or later jump.
  const before = await preview.evaluate((node) => node.scrollTop);
  await page.waitForTimeout(150);
  assert.ok(Math.abs((await preview.evaluate((node) => node.scrollTop)) - before) < 1);
  for (const value of ['end', 'start']) {
    await source.evaluate((node, value) => {
      node.scrollTop = value === 'end' ? node.scrollHeight : 0;
    }, value);
    await expect
      .poll(() =>
        preview.evaluate(
          (node, value) =>
            value === 'end'
              ? Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop)
              : node.scrollTop,
          value,
        ),
      )
      .toBeLessThan(2);
    await preview.evaluate((node, value) => {
      node.scrollTop = value === 'end' ? 0 : node.scrollHeight;
    }, value);
    await expect
      .poll(() =>
        source.evaluate(
          (node, value) =>
            value === 'end'
              ? node.scrollTop
              : Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop),
          value,
        ),
      )
      .toBeLessThan(2);
  }
  await fromSource(30);
  // Width-dependent paragraph wrapping must rebuild the content map.
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect.poll(async () => Math.abs(await previewDistance(30))).toBeLessThan(3);
  await fromPreview(40);
  await page.getByRole('button', { name: 'Nguồn', exact: true }).click();
  await page.getByRole('button', { name: 'Song song', exact: true }).click();
  await fromSource(15);
  await page.setViewportSize({ width: 390, height: 844 });
  await fromPreview(35);
  await fromSource(25);
  await page.setViewportSize({ width: 1440, height: 1000 });
};
