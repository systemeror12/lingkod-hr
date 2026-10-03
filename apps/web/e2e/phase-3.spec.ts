import { expect, test } from '@playwright/test';
import { activateInvitation, MARISOL_EMAIL, signIn } from './sign-in';

const apiUrl = `http://localhost:${process.env.PLAYWRIGHT_API_PORT ?? '3101'}`;
const appOrigin = `http://localhost:${process.env.PLAYWRIGHT_APP_PORT ?? '3100'}`;
const foreignUnitId = '22222222-2222-4222-8222-222222222222';
const foreignAuditEventId = '44444444-4444-4444-8444-444444444444';

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

  if (!messageId) throw new Error('The Phase 3 invitation did not arrive in Mailpit.');
  const detailResponse = await fetch(`http://localhost:8025/api/v1/message/${messageId}`);
  if (!detailResponse.ok) throw new Error('Mailpit message lookup failed.');
  return ((await detailResponse.json()) as MailpitMessage).Text;
}

async function jsonBody(response: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  const value = await response.json();
  if (typeof value !== 'object' || value === null)
    throw new Error('The API returned no JSON body.');
  return value as Record<string, unknown>;
}

test.describe('Phase 3 acceptance gate', () => {
  test('drives provisioning handoff through Draft Organization Unit audit evidence', async ({
    page,
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(90_000);
    const suffix = `${Date.now()}-${testInfo.workerIndex}`;
    const recipient = `phase3-hrmo-${suffix}@example.test`;
    const unitCode = `P3-${suffix}`;
    const unitName = 'Phase 3 Records Management Division';
    const originHeaders = { origin: appOrigin };

    await signIn(page, MARISOL_EMAIL, { fresh: true });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
    await expect(
      page.getByText('National Archives Coordination Office', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(/Agency Administrator/).first()).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('phase3-admin-dashboard.png'),
      fullPage: true,
    });

    const navigation = page.getByRole('navigation', { name: 'Primary' });
    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeFocused();
    await expect(navigation.getByRole('link', { name: 'Work queue' })).toHaveAttribute(
      'title',
      'Work queue',
    );
    await page.screenshot({
      path: testInfo.outputPath('phase3-collapsed-rail.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Expand navigation' }).click();
    await page.keyboard.press('Tab');
    const focusedNavigationItem = page.locator(':focus');
    await expect(focusedNavigationItem).toBeVisible();
    const focusStyle = await focusedNavigationItem.evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        matchesFocusVisible: element.matches(':focus-visible'),
        outlineStyle: styles.outlineStyle,
        outlineWidth: Number.parseFloat(styles.outlineWidth),
      };
    });
    expect(focusStyle.matchesFocusVisible).toBe(true);
    expect(focusStyle.outlineStyle).not.toBe('none');
    expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(3);

    const meResponse = await page.request.get(`${apiUrl}/api/v1/auth/me`, {
      headers: originHeaders,
    });
    expect(meResponse.ok()).toBe(true);
    const me = (await jsonBody(meResponse)) as { agencyId?: unknown };
    if (typeof me.agencyId !== 'string') throw new Error('The active Agency Context was missing.');
    const agencyId = me.agencyId;
    const organizationUrl = `${apiUrl}/api/v1/agencies/${agencyId}/organization-units`;
    const organizationPath = `/api/v1/agencies/${agencyId}/organization-units`;
    const invitationUrl = `${apiUrl}/api/v1/agencies/${agencyId}/invitations`;
    const auditUrl = `${apiUrl}/api/v1/agencies/${agencyId}/audit-events`;

    await page.goto('/users-access');
    await expect(page.getByRole('heading', { name: 'Invite an HRMO Administrator' })).toBeVisible();
    await page.getByRole('button', { name: 'Invite user' }).click();
    const invitationDialog = page.getByRole('dialog', { name: 'Invite user' });
    await expect(invitationDialog).toHaveAccessibleDescription(
      'Send a secure, single-use invitation for an HRMO Administrator in this Agency Context.',
    );
    await expect(page.getByLabel('Email address')).toBeFocused();
    await page.getByLabel('Email address').fill(recipient);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByRole('status')).toContainText(`Invitation sent to ${recipient}`);
    await expect(
      page
        .getByRole('region', { name: 'Pending invitations' })
        .getByText(recipient, { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('phase3-invitation-sent.png'),
      fullPage: true,
    });

    const mailText = await readMailpitMessage(
      recipient,
      'LingkodHR invitation for National Archives Coordination Office',
    );
    const activationUrl = new RegExp(`${appOrigin}/invite/[A-Za-z0-9_-]{43}`).exec(mailText)?.[0];
    if (!activationUrl) throw new Error('The Phase 3 invitation email had no activation URL.');
    expect(mailText).toContain('National Archives Coordination Office');
    expect(mailText).toContain('HRMO Administrator');

    const hrmoContext = await browser.newContext();
    const hrmoPage = await hrmoContext.newPage();
    try {
      await activateInvitation(hrmoPage, activationUrl, { name: 'Phase Three Administrator' });
      await expect(hrmoPage.getByRole('heading', { name: 'Work queue' })).toBeVisible();
      await expect(hrmoPage.getByText('HRMO Administrator', { exact: true }).first()).toBeVisible();
      await expect(hrmoPage.getByRole('button', { name: 'Invite user' })).toHaveCount(0);
      await hrmoPage.screenshot({
        path: testInfo.outputPath('phase3-hrmo-dashboard.png'),
        fullPage: true,
      });

      await page.reload();
      await expect(page.getByText('No pending invitations.', { exact: true })).toBeVisible();
      await expect(page.getByText('0', { exact: true })).toBeVisible();

      const unauthenticated = await request.get(organizationUrl, { headers: originHeaders });
      expect(unauthenticated.status()).toBe(401);

      const forbiddenInvitation = await hrmoPage.request.post(invitationUrl, {
        headers: originHeaders,
        data: { email: `forbidden-${suffix}@example.test`, roleCodes: ['hrmo_administrator'] },
      });
      expect(forbiddenInvitation.status()).toBe(403);

      const foreignRecord = await hrmoPage.request.get(`${organizationUrl}/${foreignUnitId}`, {
        headers: originHeaders,
      });
      expect(foreignRecord.status()).toBe(404);

      await hrmoPage.goto('/organization');
      await expect(
        hrmoPage.getByRole('heading', { name: 'Organization Units', exact: true }),
      ).toBeVisible();
      await hrmoPage.getByRole('button', { name: 'Create Organization Unit' }).click();
      const organizationDialog = hrmoPage.getByRole('dialog', {
        name: 'Create Organization Unit',
      });
      await expect(organizationDialog).toHaveAccessibleDescription(
        'Register the unit as a Draft, then place and activate it from the preparation queue.',
      );
      await expect(hrmoPage.getByLabel('Official name')).toBeFocused();
      await hrmoPage.getByLabel('Official name').fill(unitName);
      await hrmoPage.getByLabel('Agency-unique code').fill(unitCode);
      await hrmoPage.getByLabel('Unit type').selectOption('DIVISION');
      await hrmoPage.getByLabel('Effective date').fill('2026-08-16');
      const createResponsePromise = hrmoPage.waitForResponse(
        (response) =>
          response.url().includes(organizationPath) && response.request().method() === 'POST',
      );
      await hrmoPage.getByRole('button', { name: 'Create Draft' }).click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status()).toBe(201);
      const created = (await jsonBody(createResponse)) as { id?: unknown };
      if (typeof created.id !== 'string')
        throw new Error('The created unit had no stable identity.');
      const unitId = created.id;
      await expect(hrmoPage.getByRole('status')).toContainText('was created.');
      const highlighted = hrmoPage
        .getByRole('row')
        .filter({ hasText: unitName })
        .filter({ hasText: unitCode });
      await expect(highlighted).toHaveAttribute('data-highlighted', 'true');
      await expect(highlighted).toContainText('DRAFT');
      await hrmoPage.screenshot({
        path: testInfo.outputPath('phase3-draft-highlighted.png'),
        fullPage: true,
      });

      const invalidInput = await hrmoPage.request.post(organizationUrl, {
        headers: originHeaders,
        data: { officialName: '', code: '', unitType: 'UNKNOWN', effectiveDate: 'invalid' },
      });
      expect(invalidInput.status()).toBe(400);
      const invalidBody = await jsonBody(invalidInput);
      expect(invalidBody).toMatchObject({
        error: { code: 'INVALID_INPUT', requestId: expect.any(String) },
      });
      expect(JSON.stringify(invalidBody)).not.toMatch(/password|secret|session|token/i);

      const conflict = await hrmoPage.request.post(organizationUrl, {
        headers: originHeaders,
        data: {
          officialName: 'Another name',
          code: unitCode,
          unitType: 'DIVISION',
          effectiveDate: '2026-08-16',
        },
      });
      expect(conflict.status()).toBe(409);
      expect(await jsonBody(conflict)).toMatchObject({
        error: { code: 'ORGANIZATION_UNIT_CODE_CONFLICT', requestId: expect.any(String) },
      });

      const persistedList = await hrmoPage.request.get(auditUrl, { headers: originHeaders });
      expect(persistedList.status()).toBe(200);
      const listBody = (await jsonBody(persistedList)) as {
        events?: Array<{
          id: string;
          entityId: string;
          action: string;
          previousStatus: string | null;
          newStatus: string | null;
        }>;
      };
      const persistedEvent = listBody.events?.find((event) => event.entityId === unitId);
      expect(persistedEvent).toMatchObject({
        action: 'ORGANIZATION_UNIT_CREATED',
        previousStatus: 'None',
        newStatus: 'DRAFT',
      });
      if (!persistedEvent) throw new Error('The persisted Organization Unit event was missing.');
      const detailResponse = await hrmoPage.request.get(`${auditUrl}/${persistedEvent.id}`, {
        headers: originHeaders,
      });
      expect(detailResponse.status()).toBe(200);
      const detailBody = await jsonBody(detailResponse);
      expect(detailBody).toMatchObject({
        action: 'ORGANIZATION_UNIT_CREATED',
        previousStatus: 'None',
        newStatus: 'DRAFT',
        after: { officialName: unitName, code: unitCode },
      });
      expect(JSON.stringify(detailBody)).not.toMatch(/password|secret|session|token/i);

      await hrmoPage.goto('/audit');
      const eventRow = hrmoPage.getByRole('row').filter({ hasText: unitId });
      await expect(eventRow).toContainText('ORGANIZATION_UNIT_CREATED');
      await expect(eventRow).toContainText('None → DRAFT');
      const event = eventRow.getByRole('button', { name: 'ORGANIZATION_UNIT_CREATED' });
      await event.click();
      const auditDialog = hrmoPage.getByRole('region', { name: 'Audit Event detail' });
      await expect(auditDialog).toBeVisible();
      await expect(auditDialog).toContainText(unitName);
      await expect(auditDialog).toContainText('None → DRAFT');
      await expect(
        hrmoPage.getByRole('button', { name: 'Close audit event detail' }),
      ).toBeFocused();

      await hrmoPage.setViewportSize({ width: 390, height: 844 });
      const narrowBox = await auditDialog.boundingBox();
      expect(narrowBox).not.toBeNull();
      if (!narrowBox) throw new Error('The narrow Audit Event surface had no geometry.');
      expect(narrowBox.x).toBeGreaterThanOrEqual(16);
      expect(narrowBox.x + narrowBox.width).toBeLessThanOrEqual(374);
      await hrmoPage.screenshot({
        path: testInfo.outputPath('phase3-audit-detail-narrow.png'),
        fullPage: true,
      });
      await hrmoPage.keyboard.press('Tab');
      expect(
        await auditDialog.evaluate((element) => element.contains(document.activeElement)),
      ).toBe(true);
      await hrmoPage.keyboard.press('Escape');
      await expect(auditDialog).toBeHidden();
      await expect(event).toBeFocused();

      const foreignAuditEvent = await hrmoPage.request.get(`${auditUrl}/${foreignAuditEventId}`, {
        headers: originHeaders,
      });
      expect(foreignAuditEvent.status()).toBe(404);
    } finally {
      await hrmoContext.close();
    }
  });
});
