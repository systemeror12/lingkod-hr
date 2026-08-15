import { expect, test } from '@playwright/test';

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

test('invites and activates an HRMO Administrator through Mailpit and local OIDC', async ({
  page,
  browser,
}, testInfo) => {
  const recipient = `hrmo-${Date.now()}@example.test`;

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/users-access');
  await expect(page.getByRole('heading', { name: 'Invite an HRMO Administrator' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('invitation-ready.png'), fullPage: true });
  await page.getByRole('button', { name: 'Invite user' }).click();
  await expect(page.getByRole('dialog', { name: 'Invite user' })).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeFocused();
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
  const activationUrl =
    /https?:\/\/[^\s]+\/api\/v1\/auth\/invitations\/([A-Za-z0-9_-]{43})\/activate/.exec(
      mailText,
    )?.[0];
  if (!activationUrl)
    throw new Error('The HRMO invitation email did not contain an activation link.');
  expect(mailText).toContain('National Archives Coordination Office');
  expect(mailText).toContain('HRMO Administrator');

  const hrmoContext = await browser.newContext();
  const hrmoPage = await hrmoContext.newPage();
  try {
    await hrmoPage.goto(activationUrl);
    await expect(
      hrmoPage.getByRole('heading', { name: 'You’re about to continue to secure sign-in' }),
    ).toBeVisible();
    await hrmoPage.screenshot({
      path: testInfo.outputPath('invitation-transition.png'),
      fullPage: true,
    });
    await hrmoPage.getByRole('link', { name: 'Continue to secure sign-in' }).click();
    await expect(hrmoPage).toHaveURL(/\/dashboard$/);
    await expect(hrmoPage.getByRole('heading', { name: 'Work queue' })).toBeVisible();
    await expect(hrmoPage.getByText('HRMO Administrator', { exact: true }).first()).toBeVisible();
    await hrmoPage.screenshot({ path: testInfo.outputPath('hrmo-handoff.png'), fullPage: true });
    await expect(
      hrmoPage.getByRole('navigation', { name: 'Primary' }).getByRole('link', {
        name: 'Users & Access',
      }),
    ).toHaveCount(0);
    await expect(hrmoPage.getByRole('button', { name: 'Invite user' })).toHaveCount(0);

    const me = await hrmoPage.request.get('http://localhost:3101/api/v1/auth/me', {
      headers: { origin: 'http://localhost:3100' },
    });
    expect(me.ok()).toBe(true);
    const session = (await me.json()) as { agencyId: string };
    const forbidden = await hrmoPage.request.post(
      `http://localhost:3101/api/v1/agencies/${session.agencyId}/invitations`,
      {
        headers: { origin: 'http://localhost:3100' },
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

test('keeps the invitation dialog keyboard-safe at a narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/users-access');
  await page.getByRole('button', { name: 'Invite user' }).click();
  await expect(page.getByRole('dialog', { name: 'Invite user' })).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Invite user' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Invite user' })).toBeFocused();
});
