import { expect, test, type Locator } from '@playwright/test';
import { activateInvitation, MARISOL_EMAIL, signIn } from './sign-in';

const apiUrl = `http://localhost:${process.env.PLAYWRIGHT_API_PORT ?? '3101'}`;
const appOrigin = `http://localhost:${process.env.PLAYWRIGHT_APP_PORT ?? '3100'}`;

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

interface MailpitMessagesResponse {
  messages: MailpitMessageSummary[];
}

interface MailpitMessage {
  Text: string;
}

async function expectInvitationDialog(dialog: Locator): Promise<void> {
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    'Send a secure, single-use invitation for an HRMO Administrator in this Agency Context.',
  );
}

async function readMailpitMessage(recipient: string, subject: string): Promise<string> {
  let messageId: string | null = null;
  await expect
    .poll(
      async () => {
        const response = await fetch('http://localhost:8025/api/v1/messages');
        if (!response.ok) throw new Error('Mailpit message listing failed.');
        const payload = (await response.json()) as MailpitMessagesResponse;
        const summary = payload.messages.find(
          (message) =>
            message.Subject === subject && message.To.some(({ Address }) => Address === recipient),
        );
        messageId = summary?.ID ?? null;
        return messageId !== null;
      },
      { intervals: [100], timeout: 2_000 },
    )
    .toBe(true);
  if (!messageId) throw new Error('The HRMO invitation message did not arrive in Mailpit.');
  const detailResponse = await fetch(`http://localhost:8025/api/v1/message/${messageId}`);
  if (!detailResponse.ok) throw new Error('Mailpit message lookup failed.');
  return ((await detailResponse.json()) as MailpitMessage).Text;
}

test('invites and activates a first-time HRMO Administrator through Mailpit', async ({
  page,
  browser,
}, testInfo) => {
  const recipient = `hrmo-${Date.now()}@example.test`;

  await signIn(page, MARISOL_EMAIL, { fresh: true });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/users-access');
  await expect(page.getByRole('heading', { name: 'Invite an HRMO Administrator' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('invitation-ready.png'), fullPage: true });
  await page.getByRole('button', { name: 'Invite user' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite user' });
  await expectInvitationDialog(dialog);
  await expect(page.getByLabel('Email address')).toBeFocused();
  const desktopViewport = page.viewportSize();
  const desktopDialogBox = await dialog.boundingBox();
  expect(desktopViewport).not.toBeNull();
  expect(desktopDialogBox).not.toBeNull();
  if (!desktopViewport || !desktopDialogBox) {
    throw new Error('The desktop invitation dialog geometry was unavailable.');
  }
  expect(desktopDialogBox.x).toBeGreaterThanOrEqual(16);
  expect(desktopDialogBox.x + desktopDialogBox.width).toBeLessThanOrEqual(
    desktopViewport.width - 16,
  );
  expect(
    Math.abs(desktopDialogBox.x + desktopDialogBox.width / 2 - desktopViewport.width / 2),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('invitation-modal-desktop.png'),
    fullPage: true,
  });
  await page.getByLabel('Email address').fill(recipient);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('status')).toContainText(`Invitation sent to ${recipient}`);
  await expect(page.getByRole('button', { name: 'Invite user' })).toBeFocused();
  await expect(
    page.getByRole('region', { name: 'Pending invitations' }).getByText(recipient, { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('invitation-sent.png'), fullPage: true });
  await expect(
    page.getByRole('region', { name: 'Pending invitations' }).getByText('Pending', { exact: true }),
  ).toBeVisible();

  const mailText = await readMailpitMessage(
    recipient,
    'LingkodHR invitation for National Archives Coordination Office',
  );
  const activationUrl = new RegExp(`${appOrigin}/invite/[A-Za-z0-9_-]{43}`).exec(mailText)?.[0];
  if (!activationUrl)
    throw new Error('The HRMO invitation email did not contain an activation link.');
  expect(mailText).toContain('National Archives Coordination Office');
  expect(mailText).toContain('HRMO Administrator');

  const hrmoContext = await browser.newContext();
  const hrmoPage = await hrmoContext.newPage();
  try {
    await hrmoPage.goto(activationUrl);
    await expect(
      hrmoPage.getByRole('heading', { name: 'Activate your LingkodHR access' }),
    ).toBeVisible();
    await expect(hrmoPage.getByLabel('Email')).toHaveValue(recipient);
    await expect(hrmoPage.getByText(/^Maligayang pagdating sa /)).toBeVisible();
    await hrmoPage.screenshot({
      path: testInfo.outputPath('invitation-activation.png'),
      fullPage: true,
    });
    await activateInvitation(hrmoPage, activationUrl, { name: 'Hiraya Dela Cruz' });
    await expect(hrmoPage.getByRole('heading', { name: 'Work queue' })).toBeVisible();
    await expect(hrmoPage.getByText('HRMO Administrator', { exact: true }).first()).toBeVisible();
    await hrmoPage.screenshot({ path: testInfo.outputPath('hrmo-activated.png'), fullPage: true });
    await hrmoPage
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'Structure' })
      .click();
    await expect(
      hrmoPage.getByRole('navigation', { name: 'Primary' }).getByRole('link', {
        name: 'Organization',
      }),
    ).toBeVisible();
    await expect(hrmoPage.getByRole('button', { name: 'Invite user' })).toHaveCount(0);

    const me = await hrmoPage.request.get(`${apiUrl}/api/v1/auth/me`, {
      headers: { origin: appOrigin },
    });
    expect(me.ok()).toBe(true);
    const session = (await me.json()) as { agencyId: string };
    const forbidden = await hrmoPage.request.post(
      `${apiUrl}/api/v1/agencies/${session.agencyId}/invitations`,
      {
        headers: { origin: appOrigin },
        data: { email: 'forbidden@example.test', roleCodes: ['hrmo_administrator'] },
      },
    );
    expect(forbidden.status()).toBe(403);
  } finally {
    await hrmoContext.close();
  }

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pending invitations' })).toBeVisible();
  await expect(page.getByText('No pending invitations.', { exact: true })).toBeVisible();
  await expect(page.getByText('0', { exact: true })).toBeVisible();
});

test('keeps the invitation dialog keyboard-safe at a narrow width', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, MARISOL_EMAIL);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/users-access');
  await expect(page.getByRole('heading', { name: 'Invite an HRMO Administrator' })).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Invite user' });
  await page.screenshot({
    path: testInfo.outputPath('invitation-ready-narrow.png'),
    fullPage: true,
  });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Invite user' });
  await expectInvitationDialog(dialog);
  await expect(page.getByLabel('Email address')).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath('invitation-modal-narrow.png'),
    fullPage: true,
  });

  const viewport = page.viewportSize();
  const dialogBox = await dialog.boundingBox();
  expect(viewport).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  if (!viewport || !dialogBox) throw new Error('The invitation dialog geometry was unavailable.');
  expect(dialogBox.x).toBeGreaterThanOrEqual(16);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width - 16);
  expect(Math.abs(dialogBox.x + dialogBox.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send invitation' })).toBeVisible();

  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();

  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    await expect(dialog.locator(':focus')).toHaveCount(1);
  }
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.locator(':focus')).toHaveCount(1);
  }

  await page.getByRole('button', { name: 'Close invitation dialog' }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('keeps invitation framing visible while the body scrolls on a short viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 320 });
  await signIn(page, MARISOL_EMAIL);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/users-access');
  await page.getByRole('button', { name: 'Invite user' }).click();

  const dialog = page.getByRole('dialog', { name: 'Invite user' });
  const title = dialog.getByRole('heading', { name: 'Invite user' });
  const helper = page.getByText(
    'Use the verified email address of the individual who will accept the invitation.',
    { exact: true },
  );
  const sendButton = page.getByRole('button', { name: 'Send invitation' });
  await expect(dialog).toBeVisible();
  await expect(title).toBeInViewport();
  await expect(sendButton).toBeInViewport();

  const titleBefore = await title.boundingBox();
  const helperBefore = await helper.boundingBox();
  const emailBox = await page.getByLabel('Email address').boundingBox();
  expect(titleBefore).not.toBeNull();
  expect(helperBefore).not.toBeNull();
  expect(emailBox).not.toBeNull();
  if (!titleBefore || !helperBefore || !emailBox) {
    throw new Error('The constrained invitation geometry was unavailable.');
  }

  await page.mouse.move(emailBox.x + emailBox.width / 2, emailBox.y + emailBox.height / 2);
  await page.mouse.wheel(0, 160);
  await expect
    .poll(async () => (await helper.boundingBox())?.y ?? Number.POSITIVE_INFINITY)
    .toBeLessThan(helperBefore.y);

  const titleAfter = await title.boundingBox();
  const helperAfter = await helper.boundingBox();
  expect(titleAfter).not.toBeNull();
  expect(helperAfter).not.toBeNull();
  if (!titleAfter || !helperAfter) {
    throw new Error('The scrolled invitation geometry was unavailable.');
  }
  expect(Math.abs(titleAfter.y - titleBefore.y)).toBeLessThanOrEqual(1);
  expect(helperAfter.y).toBeLessThan(helperBefore.y);
  await expect(title).toBeInViewport();
  await expect(sendButton).toBeInViewport();
});

test('guards every invitation dismissal path during submission', async ({ page }) => {
  const recipient = `held-${Date.now()}@example.test`;
  let releaseResponse!: () => void;
  const responseReleased = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  await page.route('**/api/v1/agencies/*/invitations', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await responseReleased;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'held-invitation',
        email: recipient,
        expiresAt: '2026-08-22T00:00:00.000Z',
      }),
    });
  });

  await signIn(page, MARISOL_EMAIL);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/users-access');
  const trigger = page.getByRole('button', { name: 'Invite user' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Invite user' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Email address').fill(recipient);
  const sendButton = page.getByRole('button', { name: /Send invitation|Sending…/ });
  await sendButton.click();
  await expect(sendButton).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Close invitation dialog' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();

  releaseResponse();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
