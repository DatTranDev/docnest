/* Real-service library interactions and visual checks; no intercepted API responses. */
const { chromium } = require('playwright');
const { readFileSync, mkdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:8080';
const root = /^MYSQL_ROOT_PASSWORD=(.*)$/m.exec(readFileSync('.env', 'utf8'))?.[1]?.trim();
assert.ok(root, 'Initialize the local environment first');
const report = 'testing/reports/raw';
const documents = [];
const folders = [];
let stage = 'startup';

async function register(context, email, displayName) {
  const password = createHash('sha256')
    .update(root + email)
    .digest('hex')
    .slice(0, 32);
  const csrf = await (await context.request.get(base + '/api/v1/auth/csrf')).json();
  const response = await context.request.post(base + '/api/v1/auth/register', {
    headers: { Origin: base, [csrf.headerName]: csrf.token },
    data: { email, password, displayName },
  });
  assert.ok([201, 409].includes(response.status()), 'Fixture registration');
  return password;
}
async function login(page, email, password) {
  await page.goto(base);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const authenticated = await response;
  assert.equal(authenticated.status(), 200, 'Fixture login');
  await page.getByRole('button', { name: 'New', exact: true }).waitFor();
  return (await authenticated.json()).accessToken;
}
async function api(context, token, path, method = 'GET', data, expected = 200) {
  const response = await context.request.fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(data === undefined ? {} : { data }),
  });
  assert.equal(response.status(), expected, 'Fixture API status');
  return expected === 204 ? null : response.json();
}
async function assertLayout(page) {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'No horizontal page overflow',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Grid view' }).getAttribute('aria-pressed'),
    'true',
  );
}
async function createWrittenDocument(page, title, text) {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept(title));
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/documents') && r.request().method() === 'POST',
  );
  await page.getByRole('menuitem', { name: 'New document', exact: true }).click();
  const createdResponse = await created;
  if (createdResponse.status() !== 201)
    console.error(`Document fixture creation HTTP ${createdResponse.status()}`);
  assert.equal(createdResponse.status(), 201, 'Document fixture creation');
  const document = await createdResponse.json();
  documents.push(document.id);
  await page.locator('.cm-content').click();
  await page.keyboard.insertText(text);
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/documents/${document.id}/versions`) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.ok([200, 201].includes((await saved).status()), 'Real native save');
  await page.locator('.save-status').getByText('Saved', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Document list', exact: true }).click();
  return document;
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.addCookies([{ name: 'ted-locale', value: 'en', url: base }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', () => errors.push('Browser exception'));
  let token;
  let previewFolder;
  const openPreview = async () => {
    await page
      .locator('.sidebar')
      .getByRole('button', { name: 'My documents', exact: true })
      .click();
    await page
      .getByRole('article', { name: previewFolder.name, exact: true })
      .getByRole('button', { name: previewFolder.name, exact: true })
      .click();
  };
  try {
    const email = 'smoke-recipient@editor.test';
    stage = 'fixture registration';
    const password = await register(context, email, 'Alex Morgan');
    stage = 'fixture login';
    token = await login(page, email, password);
    stage = 'empty library and keyboard creation menu';
    await page.getByRole('button', { name: 'New', exact: true }).click();
    page.once('dialog', (dialog) => dialog.accept('Workspace preview'));
    const createdFolder = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/folders') && r.request().method() === 'POST',
    );
    await page.getByRole('menuitem', { name: 'New folder', exact: true }).click();
    const folderResponse = await createdFolder;
    assert.equal(folderResponse.status(), 201);
    previewFolder = await folderResponse.json();
    stage = 'open disposable preview folder';
    await openPreview();
    stage = 'empty preview folder';
    await page.getByRole('heading', { name: 'A space for your documents' }).waitFor();
    const newButton = page.getByRole('button', { name: 'New', exact: true });
    stage = 'keyboard creation menu';
    await newButton.focus();
    await page.keyboard.press('ArrowDown');
    await page.getByRole('menuitem', { name: 'New document', exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole('menuitem', { name: 'New document', exact: true })
        .evaluate((el) => document.activeElement === el),
      true,
    );
    await page.keyboard.press('ArrowDown');
    assert.equal(
      await page
        .getByRole('menuitem', { name: 'New folder', exact: true })
        .evaluate((el) => document.activeElement === el),
      true,
    );
    await page.keyboard.press('Escape');
    assert.equal(await newButton.getAttribute('aria-expanded'), 'false');
    assert.equal(await newButton.evaluate((el) => document.activeElement === el), true);
    stage = 'real document cards and editor return';
    const roadmap = await createWrittenDocument(
      page,
      'Product roadmap',
      'Product roadmap\n\nA calmer space to work\n\nThis quarter, we are focusing on a simpler document library, better navigation and reliable collaboration.\n\nExplore\nOrganize project notes into folders. Keep useful references close to the work.\n\nBuild\nWrite, review and share one document at a time.',
    );
    await createWrittenDocument(
      page,
      'Weekly meeting notes',
      'Weekly meeting notes\n\nMonday, 12 October\n\nAgenda\nReview the latest research. Agree on the next release.\n\nDecisions\nKeep the library focused on documents. Make every action easy to find.\n\nNext steps\nPrepare the first draft and gather feedback from the team.',
    );
    stage = 'library return preserves unsaved editor';
    await page
      .getByRole('article', { name: 'Product roadmap', exact: true })
      .getByRole('button', { name: 'Product roadmap', exact: true })
      .click();
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText('\nUnsent edit');
    await page.locator('.save-status').getByText('Unsaved', { exact: true }).waitFor();
    await page.evaluate(() => {
      window.__libraryEditor = document.querySelector('.cm-content');
    });
    await page.getByRole('button', { name: 'Document list', exact: true }).click();
    await page.getByRole('button', { name: 'Return to editor', exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.__libraryEditor === document.querySelector('.cm-content')),
      true,
      'Editor DOM retained',
    );
    assert.ok(
      (await page.locator('.cm-content').innerText()).includes('Unsent edit'),
      'Unsaved text retained',
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('.save-status').getByText('Saved', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Document list', exact: true }).click();
    stage = 'real document cards and editor return';
    for (const name of ['Projects', 'Research', 'Personal', 'Archive']) {
      const folder = await api(
        context,
        token,
        '/api/v1/folders',
        'POST',
        { name, parentId: previewFolder.id },
        201,
      );
      folders.push(folder);
    }
    for (const title of [
      'Reading list',
      'Project brief',
      'Ideas for the next chapter',
      'Travel journal',
    ]) {
      const document = await api(
        context,
        token,
        '/api/v1/documents',
        'POST',
        { title, folderId: previewFolder.id },
        201,
      );
      documents.push(document.id);
    }
    await page.reload();
    await openPreview();
    await page.locator('.folder-file').nth(3).waitFor();
    await page.locator('.document-file').nth(5).waitFor();
    await page.locator('.document-paper').first().waitFor({ timeout: 30000 });
    await assertLayout(page);
    mkdirSync(report, { recursive: true });
    await page.screenshot({ path: `${report}/workspace-desktop.png`, fullPage: true });
    stage = 'list preference, ordering, filters and search';
    await page.getByRole('button', { name: 'List view' }).click();
    await page.reload();
    await openPreview();
    await page.locator('.library-list .document-file').nth(5).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed'),
      'true',
    );
    const before = await page.locator('.folder-file .file-label').allTextContents();
    await page.getByRole('button', { name: 'Sort visible items by name' }).click();
    assert.deepEqual(
      await page.locator('.folder-file .file-label').allTextContents(),
      before.toReversed(),
    );
    await page.screenshot({ path: `${report}/workspace-list.png`, fullPage: true });
    await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('documents');
    assert.equal(await page.locator('.folder-file').count(), 0);
    await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('all');
    const search = page.getByRole('searchbox', { name: 'Search this library' });
    await search.fill('roadmap');
    await page.locator('.document-file').filter({ hasText: 'Product roadmap' }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.document-file').length === 1);
    assert.equal(await page.locator('.folder-file').count(), 0);
    await search.fill('No matching title');
    await page.getByRole('heading', { name: 'No matching items' }).waitFor();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.locator('.document-file').nth(5).waitFor();
    await search.fill('Research');
    await page.locator('.folder-file').filter({ hasText: 'Research' }).waitFor();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.document-file').length === 0 &&
        document.querySelectorAll('.folder-file').length === 1,
    );
    assert.equal(await page.locator('.document-file').count(), 0);
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await page.locator('.document-file').nth(5).waitFor();
    await page.getByRole('button', { name: 'Grid view' }).click();
    stage = 'item menus, rename, move, trash and restore';
    const article = page.locator(`[data-document-id="${roadmap.id}"]`);
    await article.getByRole('button', { name: 'Actions for Product roadmap', exact: true }).click();
    page.once('dialog', (dialog) => dialog.accept('Product roadmap 2026'));
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await article.waitFor();
    await article
      .getByRole('button', { name: 'Actions for Product roadmap 2026', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Move', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Move', exact: true });
    await dialog
      .getByRole('combobox', { name: 'Destination folder' })
      .selectOption(folders.find((f) => f.name === 'Projects').id);
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();
    await article.waitFor({ state: 'detached' });
    await page
      .getByRole('article', { name: 'Projects', exact: true })
      .getByRole('button', { name: 'Projects', exact: true })
      .click();
    await article.waitFor();
    await article
      .getByRole('button', { name: 'Actions for Product roadmap 2026', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Move to trash', exact: true }).click();
    await article.waitFor({ state: 'detached' });
    await page.locator('.sidebar').getByRole('button', { name: 'Trash', exact: true }).click();
    await article.waitFor();
    assert.equal(await article.locator('.file-name').isDisabled(), true);
    await article
      .getByRole('button', { name: 'Actions for Product roadmap 2026', exact: true })
      .click();
    assert.equal(await page.getByRole('menuitem').count(), 1);
    await page.getByRole('menuitem', { name: 'Restore', exact: true }).click();
    await article.waitFor({ state: 'detached' });
    stage = 'viewer actions and shared empty state';
    const viewer = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    await viewer.addCookies([{ name: 'ted-locale', value: 'en', url: base }]);
    const viewerEmail = 'smoke-owner@editor.test';
    const viewerPassword = await register(viewer, viewerEmail, 'Library Viewer');
    await api(context, token, `/api/v1/documents/${roadmap.id}/permissions`, 'POST', {
      email: viewerEmail,
      role: 'VIEWER',
    });
    const viewerPage = await viewer.newPage();
    await login(viewerPage, viewerEmail, viewerPassword);
    await viewerPage
      .locator('.sidebar')
      .getByRole('button', { name: 'Shared with me', exact: true })
      .click();
    const shared = viewerPage.getByRole('article', { name: 'Product roadmap 2026', exact: true });
    await shared.waitFor();
    await shared
      .getByRole('button', { name: 'Actions for Product roadmap 2026', exact: true })
      .click();
    assert.equal(await viewerPage.getByRole('menuitem').count(), 1);
    assert.equal(
      await viewerPage.getByRole('menuitem', { name: 'Open document', exact: true }).count(),
      1,
    );
    await viewer.close();
    stage = 'mobile layout, menu bounds and bilingual labels';
    await openPreview();
    await page.locator('.document-file').nth(4).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await assertLayout(page);
    await page.screenshot({ path: `${report}/workspace-mobile.png`, fullPage: true });
    const menuTrigger = page.locator('.document-file .action-menu-trigger').last();
    await menuTrigger.click();
    const bounds = await page.getByRole('menu').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'Menu stays inside mobile viewport');
    assert.ok(
      bounds.y >= 0 && bounds.y + bounds.height <= 845,
      'Menu stays inside mobile viewport vertically',
    );
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: 'Language' }).selectOption('vi');
    await page.getByRole('button', { name: 'Dạng lưới' }).waitFor();
    assert.equal(
      await page.getByRole('searchbox', { name: 'Tìm trong thư viện hiện tại' }).count(),
      1,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.getByRole('combobox', { name: 'Ngôn ngữ' }).selectOption('en');
    await page.getByRole('button', { name: /^Account for / }).click();
    await page.getByRole('menuitem', { name: 'Subscription plans', exact: true }).click();
    await page.getByRole('dialog', { name: 'Subscription plans' }).waitFor();
    await page.getByRole('button', { name: 'Close subscription plans' }).click();
    assert.equal(errors.length, 0, 'No browser exceptions');
    console.log(
      'PASS workspace: real previews/save, keyboard menus, view preference, sorting, filters/search, move/breadcrumb, trash/restore, viewer ACL, bilingual desktop/mobile layouts.',
    );
  } catch (error) {
    mkdirSync(report, { recursive: true });
    await page
      .screenshot({ path: `${report}/workspace-failure.png`, fullPage: true })
      .catch(() => {});
    console.error(`FAIL workspace at ${stage}; protected browser data withheld (${error.name})`);
    process.exitCode = 1;
  } finally {
    if (token) {
      try {
        for (const id of documents) {
          const document = await api(context, token, `/api/v1/documents/${id}`);
          if (!document.deletedAt)
            await api(
              context,
              token,
              `/api/v1/documents/${id}`,
              'DELETE',
              { expectedMetadataRevision: document.metadataRevision },
              204,
            );
        }
        for (const folder of folders)
          await api(
            context,
            token,
            `/api/v1/folders/${folder.id}?expectedMetadataRevision=${folder.metadataRevision}`,
            'DELETE',
            undefined,
            204,
          );
        if (previewFolder)
          await api(
            context,
            token,
            `/api/v1/folders/${previewFolder.id}?expectedMetadataRevision=${previewFolder.metadataRevision}`,
            'DELETE',
            undefined,
            204,
          );
      } catch {
        console.error('FAIL disposable workspace fixture cleanup');
        process.exitCode = 1;
      }
    }
    await browser.close();
  }
})();
