import { chromium } from "../../../node_modules/@playwright/test/index.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { binary } from "./media.mjs";

const origin = process.env.DEMO_ORIGIN ?? "http://127.0.0.1:8080";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) {
  throw new Error("Capture requires a local app or local development gateway.");
}
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "public/captures");
const privateDir = path.resolve(root, "../../.secrets");
await mkdir(output, { recursive: true });
await mkdir(privateDir, { recursive: true });
const credentialsPath = path.join(privateDir, "docnivo-demo.json");
let accounts;
try {
  if (process.env.DEMO_FRESH === "1")
    throw new Error("Fresh demo accounts requested");
  accounts = JSON.parse(await readFile(credentialsPath, "utf8"));
} catch {
  const suffix = randomBytes(5).toString("hex");
  accounts = ["Alex Morgan", "Jamie Chen"].map((name, index) => ({
    name,
    email: `${index ? "jamie" : "alex"}.${suffix}@example.com`,
    password: randomBytes(24).toString("base64url"),
    registered: false,
  }));
  await writeFile(credentialsPath, JSON.stringify(accounts));
}
const browser = await chromium.launch({ headless: true });
const contexts = [];
const recordingStarts = new Map();
const evidence = {
  viewport: { width: 1440, height: 700 },
  deviceScaleFactor: 2,
  features: [],
};
async function signIn(account, record = false) {
  const context = await browser.newContext({
    viewport: evidence.viewport,
    deviceScaleFactor: 2,
    permissions: ["clipboard-read", "clipboard-write"],
    reducedMotion: "reduce",
    ...(record
      ? {
          recordVideo: {
            dir: path.join(root, "out/raw"),
            size: evidence.viewport,
          },
        }
      : {}),
  });
  contexts.push(context);
  await context.addCookies([{ name: "ted-locale", value: "en", url: origin }]);
  const page = await context.newPage();
  if (record) recordingStarts.set(page, Date.now());
  await page.goto(origin);
  await page.getByRole("textbox", { name: "Email", exact: true }).waitFor();
  if (!account.registered) {
    await page
      .getByRole("button", { name: "Create a new account", exact: true })
      .click();
    await page.locator('input[name="displayName"]').fill(account.name);
  }
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.locator("form button.primary").click();
  await page
    .getByRole("button", { name: "Create or import", exact: true })
    .waitFor({ timeout: 60000 });
  account.registered = true;
  await writeFile(credentialsPath, JSON.stringify(accounts));
  await page.addStyleTag({
    content:
      '* { cursor:none !important; caret-color:transparent !important; } input[aria-label="Public link"] { -webkit-text-security:disc; } nextjs-portal { display:none !important; }',
  });
  await page.evaluate(() => document.fonts.ready);
  return page;
}
async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    animations: "disabled",
  });
}
async function newDocument(page, title, body) {
  await page
    .getByRole("button", { name: "Create or import", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "New document", exact: true })
    .click();
  await page.locator('.cm-content[contenteditable="true"]').waitFor();
  console.log("Editor available");
  const titleControl = page.getByRole("button", { name: /Rename/ });
  if (await titleControl.count()) await titleControl.click();
  else await page.locator(".editable-title").dblclick();
  const titleInput = page.locator(".editor-identity input");
  await titleInput.fill(title);
  await titleInput.press("Enter");
  await page
    .getByRole("button", { name: `Rename: ${title}`, exact: true })
    .waitFor();
  if (body)
    await page.locator('.cm-content[contenteditable="true"]').fill(body);
}
try {
  const owner = await signIn(accounts[0]);
  const guest = await signIn(accounts[1], true);
  console.log("Two dedicated fictional accounts authenticated");
  // Seed genuine documents through the UI; never intercept application APIs.
  for (const [title, body] of [
    [
      "Research notes",
      "Listen first.\n\nGather the small observations that make the next idea better.",
    ],
    [
      "Team principles",
      "Work with care.\n\nMake room for focused work and thoughtful feedback.",
    ],
  ]) {
    await newDocument(owner, title, body);
    const save = owner.getByRole("button", { name: "Save", exact: true });
    if (await save.isVisible()) await save.click();
    await owner.getByText("Saved to cloud", { exact: true }).waitFor();
    await owner.locator(".back-to-files").click();
  }
  // Preview generation is asynchronous. Refresh the actual library until it settles.
  for (let attempt = 0; attempt < 10; attempt++) {
    await owner.reload();
    await owner
      .getByRole("button", { name: "Create or import", exact: true })
      .waitFor();
    await owner
      .getByRole("button", { name: "Team principles", exact: true })
      .waitFor();
    await owner.addStyleTag({
      content:
        '* { cursor:none !important; caret-color:transparent !important; } input[aria-label="Public link"] { -webkit-text-security:disc; } nextjs-portal { display:none !important; }',
    });
    if ((await owner.locator(".preview-placeholder").count()) === 0) break;
    await owner.waitForTimeout(1000);
  }
  if (await owner.locator(".preview-placeholder").count())
    throw new Error("Document previews have not settled");
  await shot(owner, "workspace");
  await owner
    .getByRole("button", { name: "Create or import", exact: true })
    .click();
  await shot(owner, "new-menu");
  await owner.keyboard.press("Escape");
  await newDocument(owner, "Product Vision", "");
  await owner.locator('.cm-content[contenteditable="true"]').click();
  await shot(owner, "editor-empty");
  const paragraphs = [
    "A calmer way to work.",
    "\n\nBring ideas, decisions, and people into one shared space.",
    "\n\nOur focus",
    "\nCreate with clarity.",
    "\nBuild together.",
    "\nShare with confidence.",
  ];
  const editor = owner.locator('.cm-content[contenteditable="true"]');
  let step = 0;
  for (const paragraph of paragraphs) {
    for (const word of paragraph.match(/\s*\S+/g) ?? []) {
      await editor.pressSequentially(word);
      await shot(owner, `write-${String(step++).padStart(2, "0")}`);
    }
  }
  const save = owner.getByRole("button", { name: "Save", exact: true });
  if (await save.isVisible()) await save.click();
  await owner.getByText("Saved to cloud", { exact: true }).waitFor();
  await shot(owner, "written");
  evidence.features.push(
    "Created, renamed, typed and saved a real rich document",
  );
  await owner.getByRole("button", { name: "Share", exact: true }).click();
  await owner
    .getByRole("textbox", { name: "Recipient email", exact: true })
    .fill(accounts[1].email);
  await owner.getByRole("button", { name: "Permission", exact: true }).click();
  await owner.getByRole("option", { name: "Editor", exact: true }).click();
  await owner.getByRole("button", { name: "Add person", exact: true }).click();
  await owner.getByText("Access updated.", { exact: true }).waitFor();
  await owner.getByRole("button", { name: "Close", exact: true }).click();
  const clipStart = (Date.now() - recordingStarts.get(guest)) / 1000;
  await guest
    .getByRole("button", { name: "Shared with me", exact: true })
    .click();
  await guest
    .getByRole("button", { name: "Product Vision", exact: true })
    .click();
  await guest.locator('.cm-content[contenteditable="true"]').waitFor();
  await owner
    .getByLabel("Active collaborators", { exact: true })
    .waitFor({ timeout: 30000 });
  await shot(owner, "collaboration-joined");
  const remote = guest.locator('.cm-content[contenteditable="true"]');
  await remote.click();
  await remote.press("Control+End");
  let editStep = 0;
  for (const word of ["\n\nMade", " for", " teams", " with", " ideas."]) {
    await remote.pressSequentially(word);
    await owner
      .getByText(
        `Made for teams with ideas.`.slice(
          0,
          [
            "Made",
            "Made for",
            "Made for teams",
            "Made for teams with",
            "Made for teams with ideas.",
          ][editStep].length,
        ),
        { exact: false },
      )
      .waitFor();
    await shot(owner, `collaboration-${editStep++}`);
  }
  await shot(guest, "collaboration-guest");
  await shot(owner, "collaboration-complete");
  const clipDuration =
    (Date.now() - recordingStarts.get(guest)) / 1000 - clipStart;
  await guest.context().close();
  const source = await guest.video().path();
  const encoded = spawnSync(
    binary("ffmpeg"),
    [
      "-y",
      "-ss",
      String(clipStart),
      "-i",
      source,
      "-t",
      String(clipDuration),
      "-an",
      "-c:v",
      "libvpx-vp9",
      "-crf",
      "30",
      "-b:v",
      "0",
      path.join(output, "collaboration-source.webm"),
    ],
    { stdio: "ignore" },
  );
  if (encoded.status !== 0) throw new Error("Source recording trim failed");
  evidence.features.push(
    "Jamie joined with Editor access; Jamie’s text arrived in Alex’s session",
  );
  const finalSave = owner.getByRole("button", { name: "Save", exact: true });
  if (await finalSave.isVisible()) await finalSave.click();
  await owner.getByText("Saved to cloud", { exact: true }).waitFor();
  await owner.getByRole("button", { name: "Share", exact: true }).click();
  await owner
    .locator(".share-person-row")
    .filter({ hasText: accounts[1].email })
    .waitFor();
  await shot(owner, "share-dialog");
  await owner
    .getByRole("button", { name: "Create a 7-day link", exact: true })
    .click();
  await owner
    .getByRole("textbox", { name: "Public link", exact: true })
    .waitFor();
  await shot(owner, "share-created");
  await owner.getByRole("button", { name: "Copy", exact: true }).click();
  await owner.getByText("Link copied.", { exact: true }).waitFor();
  await shot(owner, "share-copied");
  evidence.features.push(
    "Created a real seven-day public viewing link and copied it; token redacted",
  );
  await owner.getByRole("button", { name: "Revoke link", exact: true }).click();
  evidence.linkRevokedAfterCapture = true;
  await owner.getByRole("button", { name: "Close", exact: true }).click();
  await shot(owner, "editor-return");
  await writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(
      { ...evidence, writingSteps: step, capturedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(
    "Capture complete; real collaboration and link copy verified; public link revoked",
  );
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
