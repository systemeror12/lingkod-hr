import { expect, test } from '@playwright/test';
import { signIn } from './sign-in';

// A User no other spec signs out, so ending its session leaves their cached sessions alone.
const READER_EMAIL = 'context.reader@example.test';

test('signs out from the shell, keeping the session when the server does not confirm it', async ({
  page,
}) => {
  await signIn(page, READER_EMAIL, { fresh: true });
  const signOut = page.getByRole('button', { name: 'Sign out' });

  // Collapsed rail and mobile menu each show the control.
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(signOut).toBeVisible();
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await page.setViewportSize({ width: 720, height: 900 });
  await expect(signOut).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(signOut).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });

  // A failed sign-out disables the control while pending, then says the session is still open.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/v1/auth/logout', async (route) => {
    await held;
    await route.fulfill({ status: 503, json: { error: { message: 'Unavailable' } } });
  });
  await signOut.click();
  await expect(signOut).toBeDisabled();
  release();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Sign-out didn’t complete' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(signOut).toBeEnabled();
  await page.unroute('**/api/v1/auth/logout');

  // From the keyboard, a real sign-out ends the session.
  await signOut.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/sign-in$/);
  const cookies = await page.context().cookies();
  expect(cookies.some(({ name }) => name === 'hris_session')).toBe(false);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in$/);
});
