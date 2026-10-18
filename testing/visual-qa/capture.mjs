import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const urlArg = value('--url');
const label = value('--label');
if (!urlArg || !label || !/^[a-z0-9-]+$/.test(label)) {
  throw new Error(
    'Usage: node testing/visual-qa/capture.mjs --url http://127.0.0.1:8080/intro --label intro',
  );
}

const url = new URL(urlArg);
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
  throw new Error('Visual QA only accepts a local HTTP URL.');
}

const outDir = path.resolve('testing/reports/visual-qa', label);
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];
const observations = [];

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(outDir, `${viewport.name}.png`), fullPage: true });
    const metrics = await page.evaluate(() => ({
      title: document.title,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    observations.push({
      viewport,
      status: response?.status() ?? null,
      url: page.url(),
      ...metrics,
      pageErrors,
    });
    await page.close();
  }
} finally {
  await browser.close();
}

await writeFile(
  path.join(outDir, 'observations.json'),
  `${JSON.stringify(observations, null, 2)}\n`,
);
for (const item of observations) {
  console.log(
    `${item.viewport.name}: HTTP ${item.status}, overflow=${item.horizontalOverflow}, errors=${item.pageErrors.length}`,
  );
}
console.log(`Screenshots and observations: ${outDir}`);
if (observations.some((item) => item.status !== 200 || item.pageErrors.length > 0)) {
  process.exitCode = 1;
}
