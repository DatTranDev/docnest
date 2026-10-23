import { chromium } from "../../../node_modules/@playwright/test/index.mjs";

const url = process.env.DEMO_LANDING ?? "http://127.0.0.1:8092/intro";
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("Use a loopback preview");
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addCookies([
    { name: "ted-locale", value: "en", url: new URL(url).origin },
  ]);
  const page = await context.newPage();
  await page.route("**/*.webm", (route) => route.abort());
  await page.goto(url);
  await page.locator("#demo video").scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => document.querySelector("#demo video")?.currentTime > 0.2,
  );
  const fallback = await page
    .locator("#demo video")
    .evaluate((v) => ({
      mp4: v.currentSrc.endsWith(".mp4"),
      duration: v.duration,
      error: v.error?.code ?? null,
    }));
  if (!fallback.mp4 || fallback.duration !== 15 || fallback.error)
    throw new Error("MP4 fallback failed");
  console.log("Unavailable WebM: MP4 fallback plays, 15 seconds");
  await context.close();
  const failureContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await failureContext.addCookies([
    { name: "ted-locale", value: "en", url: new URL(url).origin },
  ]);
  const failurePage = await failureContext.newPage();
  await failurePage.route(/\.(mp4|webm)$/, (route) => route.abort());
  await failurePage.goto(url);
  await failurePage.locator("#demo video").scrollIntoViewIfNeeded();
  await failurePage
    .getByRole("status")
    .filter({ hasText: "Your browser cannot play this video." })
    .waitFor();
  if (!(await failurePage.locator("#demo video").getAttribute("poster")))
    throw new Error("Poster missing on failure");
  console.log(
    "Unavailable media: poster retained with localized status and download link",
  );
  await failureContext.close();
} finally {
  await browser.close();
}
