import { expect, type Page, type Response } from '@playwright/test';

export async function loginSession(page: Page, email: string, name: string): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Testing-password-42!');
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const pending = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    response = await pending;
    if (response.status() !== 429) break;
    // Honor the actual Redis/IP limit without clearing counters or faking a response.
    await page.waitForTimeout((Number(response.headers()['retry-after'] ?? 60) + 1) * 1000);
  }
  expect(response).toBeDefined();
  if (response!.status() === 401) {
    await page.getByRole('button', { name: 'Tạo tài khoản mới', exact: true }).click();
    await page.getByLabel('Tên hiển thị', { exact: true }).fill(name);
    const registered = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/auth/register') && r.request().method() === 'POST',
    );
    const loggedIn = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    expect((await registered).status()).toBe(201);
    response = await loggedIn;
  }
  expect(response!.status()).toBe(200);
  const userId = (await response!.json()).user.id as string;
  await expect(page.getByRole('button', { name: 'Tài liệu mới', exact: true })).toBeVisible();
  return userId;
}
