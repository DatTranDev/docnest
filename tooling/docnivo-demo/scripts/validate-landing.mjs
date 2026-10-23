import { chromium } from "../../../node_modules/@playwright/test/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const url = process.env.DEMO_LANDING ?? "http://127.0.0.1:8080/intro";
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("Use a loopback preview");
const output = path.resolve(
  import.meta.dirname,
  "../../../testing/reports/docnivo-demo/landing",
  new URL(url).port === "8081" ? "static" : "next",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const report = [];
try {
  for (const [
    name,
    width,
    height,
    locale,
    reducedMotion,
    colorScheme,
    saveData,
  ] of [
    ["desktop", 1440, 900, "en", "no-preference", "light", false],
    ["tablet", 768, 1024, "vi", "no-preference", "dark", false],
    ["mobile", 390, 844, "vi", "reduce", "light", false],
    ["narrow-data-saver", 360, 800, "en", "no-preference", "light", true],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion,
      colorScheme,
    });
    await context.addCookies([
      { name: "ted-locale", value: locale, url: new URL(url).origin },
    ]);
    if (saveData)
      await context.addInitScript(() =>
        Object.defineProperty(navigator, "connection", {
          value: { saveData: true, effectiveType: "4g" },
        }),
      );
    const page = await context.newPage();
    const errors = [];
    const mediaRequests = [];
    const authenticatedRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const address = new URL(request.url());
      if (/\.(mp4|webm)$/.test(address.pathname))
        mediaRequests.push(address.pathname);
      if (address.pathname.startsWith("/api/"))
        authenticatedRequests.push(address.pathname);
    });
    const response = await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const video = page.locator("#demo video");
    await video.scrollIntoViewIfNeeded();
    const automatic = reducedMotion !== "reduce" && !saveData;
    if (automatic)
      await page.waitForFunction(
        () => document.querySelector("#demo video")?.currentTime > 0.2,
      );
    const initial = await video.evaluate((v) => ({
      paused: v.paused,
      sources: v.querySelectorAll("source").length,
      controls: v.controls,
      muted: v.muted,
      loop: v.loop,
      playsInline: v.playsInline,
      width: v.getBoundingClientRect().width,
      height: v.getBoundingClientRect().height,
      currentTime: v.currentTime,
    }));
    if (automatic) {
      await page.locator(".intro-demo-playback").click();
      if (!(await video.evaluate((v) => v.paused)))
        throw new Error("Pause failed");
      await page.locator(".intro-demo-playback").click();
      await page.waitForFunction(
        () => !document.querySelector("#demo video").paused,
      );
    }
    let fullLoopObserved = false;
    if (name === "desktop" && process.env.DEMO_FULL_PLAYBACK === "1") {
      await video.evaluate((v) => {
        v.currentTime = 0;
      });
      await page.waitForFunction(
        () => document.querySelector("#demo video").currentTime > 14,
        { timeout: 20000 },
      );
      await page.waitForFunction(
        () => document.querySelector("#demo video").currentTime < 1,
        { timeout: 4000 },
      );
      fullLoopObserved = true;
      await video.evaluate((v) => {
        v.pause();
        v.currentTime = 8.7;
      });
      await page.waitForFunction(
        () => !document.querySelector("#demo video").seeking,
      );
    }
    await page.screenshot({
      path: path.join(output, `${name}.png`),
      fullPage: true,
    });
    if (!automatic) {
      if (initial.sources || mediaRequests.length)
        throw new Error("Automatic download despite motion/data preference");
      await page.locator(".intro-demo-playback").click();
      await page.waitForFunction(
        () => document.querySelector("#demo video")?.currentTime > 0.2,
      );
    }
    const media = await video.evaluate((v) => ({
      duration: v.duration,
      error: v.error?.code ?? null,
    }));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    const result = {
      name,
      status: response.status(),
      initial,
      media,
      overflow,
      errors,
      authenticatedRequests,
      mediaRequestCount: mediaRequests.length,
      fullLoopObserved,
    };
    report.push(result);
    console.log(
      `${name}: HTTP ${result.status}; overflow=${overflow}; media=${media.duration}s; errors=${errors.length}; API requests=${authenticatedRequests.length}`,
    );
    if (
      overflow ||
      errors.length ||
      authenticatedRequests.length ||
      media.error ||
      media.duration !== 15 ||
      initial.controls ||
      !initial.muted ||
      !initial.loop ||
      !initial.playsInline
    )
      throw new Error("Landing validation failed");
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(
    path.join(output, "observations.json"),
    JSON.stringify(report, null, 2),
  );
}
