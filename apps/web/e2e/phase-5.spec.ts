import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type APIResponse, type Browser, type Locator } from '@playwright/test';

const foreignAgencyId = '11111111-1111-4111-8111-111111111111';
const foreignEmployeeId = '55555555-5555-4555-8555-555555555555';
const foreignIdentifierId = '66666666-6666-4666-8666-666666666666';
const phase5OwnerToken = 'phase5-owner-invitation-token-0000000000000';
const phase5RestrictedToken = 'phase5-restricted-invitation-token-00000000';
const apiUrl = `http://localhost:${process.env.PLAYWRIGHT_API_PORT ?? '3101'}`;

test.use({ trace: 'off' });

async function body<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
}

async function activateInvitation(browser: Browser, token: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${apiUrl}/api/v1/auth/invitations/${token}/activate`);
  await page.getByRole('link', { name: 'Continue to secure sign-in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const session = await body<{ agencyId: string; membershipId: string; userId: string }>(
    await page.request.get('/api/v1/auth/me', {
      headers: { origin: new URL(page.url()).origin },
    }),
  );
  return { context, page, session };
}

function resetFixture(phase5Access = false): void {
  execFileSync('pnpm', ['--filter', '@lingkod-hr/database', 'e2e:seed:shell'], {
    cwd: resolve(__dirname, '../../..'),
    env: { ...process.env, PHASE5_ACCESS_FIXTURES: phase5Access ? 'true' : 'false' },
    stdio: 'pipe',
  });
}

function completePds(evidence: { documentId: string; versionId: string }) {
  const address = {
    houseBlockLotNo: 'N/A',
    street: 'N/A',
    subdivisionVillage: 'N/A',
    barangay: 'N/A',
    cityMunicipality: 'Quezon City',
    province: 'Metro Manila',
    zipCode: '1100',
  };
  const signature = {
    signatureDocumentId: evidence.documentId,
    signatureDocumentVersionId: evidence.versionId,
    signedAt: '2026-09-05T09:00:00.000+08:00',
    signatureDate: '2026-09-05',
  };
  return {
    asOfDate: '2026-09-05',
    personal: {
      surname: 'Dela Cruz',
      firstName: 'Maya',
      middleName: 'Santos',
      birthDate: '1992-04-12',
      birthPlace: 'Quezon City',
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      heightMeters: 1.6,
      weightKilograms: 55,
      bloodType: 'O+',
      citizenship: 'FILIPINO',
      residentialAddress: address,
      permanentAddress: address,
      telephoneNumber: 'N/A',
      mobileNumber: '09171234567',
      emailAddress: 'maya.dela.cruz@example.test',
    },
    family: {
      father: { surname: 'Dela Cruz', firstName: 'Mario', middleName: 'Reyes' },
      mother: { surname: 'Santos', firstName: 'Lina', middleName: 'Garcia' },
      children: [],
    },
    education: ['ELEMENTARY', 'SECONDARY', 'VOCATIONAL_TRADE', 'COLLEGE', 'GRADUATE_STUDIES'].map(
      (level, index) => ({
        sequenceNo: index + 1,
        level,
        schoolName: level === 'COLLEGE' ? 'University of the Philippines' : 'N/A',
        degreeCourse: level === 'COLLEGE' ? 'BS Public Administration' : 'N/A',
        periodOfAttendance: 'N/A',
        highestLevelUnits: 'N/A',
        honors: 'N/A',
      }),
    ),
    eligibility: [{ sequenceNo: 1, eligibilityName: 'N/A', examPlace: 'N/A' }],
    workExperience: [
      {
        sequenceNo: 1,
        inclusiveFrom: '2026-01-03',
        positionTitle: 'Human Resource Management Officer III',
        departmentAgencyOfficeCompany: 'National Archives Coordination Office',
        monthlySalary: 45000,
        salaryGradeStep: '18-1',
        appointmentStatus: 'Permanent',
        governmentService: 'Y',
        isCurrent: true,
      },
    ],
    voluntaryWork: [{ sequenceNo: 1, organizationNameAddress: 'N/A', positionNatureOfWork: 'N/A' }],
    learningAndDevelopment: [
      {
        sequenceNo: 1,
        interventionTitle: 'N/A',
        type: 'N/A',
        conductedSponsoredBy: 'N/A',
      },
    ],
    wes: [
      {
        contextKey: 'phase-5-gate',
        signatureDocumentId: evidence.documentId,
        signatureDocumentVersionId: evidence.versionId,
        signedAt: '2026-09-05',
        entries: [
          {
            workExperienceSequenceNo: 1,
            sequenceNo: 1,
            durationText: 'January 2026 - Present',
            position: 'Human Resource Management Officer III',
            officeUnit: 'Human Resource Management Division',
            immediateSupervisor: 'Marisol Santos',
            agencyOrganizationLocation: 'National Archives Coordination Office, Quezon City',
            actualDuties: 'Maintains personnel records and supports merit selection.',
          },
        ],
      },
    ],
    otherInformation: {
      skillsAndHobbies: 'Records indexing',
      nonAcademicDistinctions: 'N/A',
      associationMemberships: 'N/A',
    },
    declarations: {
      relatedWithinThirdDegree: false,
      relatedWithinFourthDegreeLgu: false,
      foundGuiltyAdministrativeOffense: false,
      criminallyCharged: false,
      convictedOfCrime: false,
      separatedFromService: false,
      candidateInLastElection: false,
      resignedBeforeElection: false,
      immigrantOrPermanentResident: false,
      indigenousGroupMember: false,
      personWithDisability: false,
      soloParent: false,
    },
    references: [1, 2, 3].map((sequenceNo) => ({
      sequenceNo,
      name: 'N/A',
      address: 'N/A',
      contact: 'N/A',
    })),
    certification: {
      truthDeclarationAccepted: true,
      verificationAuthorizationAccepted: true,
      misrepresentationWarningAccepted: true,
      photoDocumentId: evidence.documentId,
      photoDocumentVersionId: evidence.versionId,
      governmentIdType: 'Passport',
      governmentIdNumber: 'PDS-TEST-ONLY',
      governmentIdIssuedAt: '2026-01-02',
      governmentIdIssuedPlace: 'DFA Manila',
      employeeSignatureDocumentId: evidence.documentId,
      employeeSignatureDocumentVersionId: evidence.versionId,
      employeeSignatureDate: '2026-09-05',
      subscribedAndSwornText: 'Subscribed and sworn in Quezon City.',
      subscribedAndSwornAt: '2026-09-05T09:00:00.000+08:00',
      oathAdministeredBy: 'Marisol Santos',
      oathAdminSignatureDocumentId: evidence.documentId,
      oathAdminSignatureDocumentVersionId: evidence.versionId,
      oathAdministeredAt: '2026-09-05T09:00:00.000+08:00',
    },
    pageSignatures: ['C1', 'C2', 'C3', 'C4'].map((pageKey) => ({ pageKey, ...signature })),
  };
}

async function expectCentered(dialog: Locator, width: number): Promise<void> {
  const box = await dialog.boundingBox();
  if (!box) throw new Error('The protected-value dialog had no geometry.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(width - 16);
  expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThanOrEqual(1);
}

test('gates the representative protected personnel journey', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  resetFixture(true);
  const suffix = `${Date.now()}-${testInfo.workerIndex}`;
  const origin = () => ({ origin: new URL(page.url()).origin });
  let ownerContext: Awaited<ReturnType<typeof activateInvitation>> | null = null;
  let restrictedContext: Awaited<ReturnType<typeof activateInvitation>> | null = null;

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  const adminSession = await body<{ agencyId: string; membershipId: string; userId: string }>(
    await page.request.get('/api/v1/auth/me', { headers: origin() }),
  );
  const agencyId = adminSession.agencyId;
  const runtimeUrl =
    process.env.DATABASE_URL ?? 'postgresql://hris_app:local_app@localhost:55432/hris';
  let employeeId = '';
  let baselineId = '';
  let pdsVersionId = '';

  try {
    await test.step('create and link the protected PREBOARDING Employee', async () => {
      await page.goto('/employees/new');
      await page.getByLabel('Employee number').fill(`P5-${suffix}`);
      await page.getByLabel('Legal name').fill(`Maya Dela Cruz ${suffix}`);
      await page.getByLabel('Birth date').fill('1992-04-12');
      await page.getByLabel('Sex').selectOption('FEMALE');
      await page.getByLabel('Civil status').selectOption('SINGLE');
      await page.getByLabel('Contact email').fill('phase5.owner@example.test');
      const createdResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/employees') && response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Create employee' }).click();
      const employee = await body<{ id: string; serviceStatus: string }>(await createdResponse);
      expect(employee.serviceStatus).toBe('PREBOARDING');

      ownerContext = await activateInvitation(browser, phase5OwnerToken);
      await body(
        await page.request.post(
          `/api/v1/agencies/${agencyId}/employees/${employee.id}/membership-link`,
          {
            headers: origin(),
            data: { membershipId: ownerContext.session.membershipId },
          },
        ),
      );
      const linked = await body<{ membershipId: string; serviceStatus: string }>(
        await page.request.get(`/api/v1/agencies/${agencyId}/employees/${employee.id}`, {
          headers: origin(),
        }),
      );
      expect(linked).toMatchObject({
        membershipId: ownerContext.session.membershipId,
        serviceStatus: 'PREBOARDING',
      });
      employeeId = employee.id;
    });

    if (!ownerContext) throw new Error('The linked Employee context was not created.');
    if (!employeeId) throw new Error('The Employee identity was not captured.');

    await test.step('effectuate the evidence-backed Personnel Baseline', async () => {
      const [positions, units, documents] = await Promise.all([
        body<{ positions: Array<{ id: string; itemNumber: string; status: string }> }>(
          await page.request.get(`/api/v1/agencies/${agencyId}/plantilla-positions`, {
            headers: origin(),
          }),
        ),
        body<{ units: Array<{ id: string; code: string }> }>(
          await page.request.get(`/api/v1/agencies/${agencyId}/organization-units`, {
            headers: origin(),
          }),
        ),
        body<{
          documents: Array<{ documentId: string; documentNo: string; version: { id: string } }>;
        }>(
          await page.request.get(`/api/v1/agencies/${agencyId}/documents/versions`, {
            headers: origin(),
          }),
        ),
      ]);
      const position = positions.positions.find(({ itemNumber }) => itemNumber === 'HRM-000143');
      const unit = units.units.find(({ code }) => code === 'HRM-DIV');
      const authority = documents.documents.find(
        ({ documentNo }) => documentNo === 'E2E-PLANTILLA-AUTHORITY',
      );
      if (!position || !unit || !authority)
        throw new Error('Phase 5 baseline prerequisites are missing.');
      expect(position.status).toBe('VACANT');
      const baseline = await body<{ id: string; status: string }>(
        await page.request.post(`/api/v1/agencies/${agencyId}/personnel-baselines`, {
          headers: origin(),
          data: {
            employeeId,
            authorityDocumentId: authority.documentId,
            authorityEvidenceVersionId: authority.version.id,
            firstGovernmentServiceDate: '2020-01-01',
            agencyServiceStartDate: '2026-01-03',
            organizationUnitId: unit.id,
            appointmentStatus: 'PERMANENT',
            salaryGrade: 18,
            salaryStep: 1,
            positionId: position.id,
            reason: 'Adopt the verified existing personnel record.',
          },
        }),
      );
      await body(
        await page.request.post(
          `/api/v1/agencies/${agencyId}/personnel-baselines/${baseline.id}/submit`,
          {
            headers: origin(),
            data: {},
          },
        ),
      );
      await body(
        await page.request.post(
          `/api/v1/agencies/${agencyId}/personnel-baselines/${baseline.id}/review`,
          {
            headers: origin(),
            data: {
              decision: 'APPROVE',
              reason: 'The retained evidence and service facts were reviewed.',
            },
          },
        ),
      );
      const effective = await body<{
        status: string;
        employee: { serviceStatus: string };
        serviceSegment: { id: string; salaryGrade: number; salaryStep: number; status: string };
        positionIncumbency: { id: string; positionId: string; status: string };
      }>(
        await page.request.post(
          `/api/v1/agencies/${agencyId}/personnel-baselines/${baseline.id}/effectuate`,
          {
            headers: { ...origin(), 'idempotency-key': `p5-baseline-${suffix}` },
            data: {},
          },
        ),
      );
      expect(effective).toMatchObject({
        status: 'EFFECTIVE',
        employee: { serviceStatus: 'ACTIVE' },
        serviceSegment: { salaryGrade: 18, salaryStep: 1, status: 'ACTIVE' },
        positionIncumbency: { positionId: position.id, status: 'ACTIVE' },
      });
      const occupiedPosition = await body<{
        position: {
          status: string;
          currentVersion: {
            lifecycleStatus: string;
            versionState: string;
            qualificationStandard: { id: string };
          };
        };
      }>(
        await page.request.get(`/api/v1/agencies/${agencyId}/plantilla-positions/${position.id}`, {
          headers: origin(),
        }),
      );
      expect(occupiedPosition).toMatchObject({
        position: {
          status: 'OCCUPIED',
          currentVersion: {
            lifecycleStatus: 'OCCUPIED',
            versionState: 'ACTIVE',
            qualificationStandard: { id: expect.any(String) },
          },
        },
      });
      baselineId = baseline.id;
    });

    await test.step('complete, submit, certify, verify, and render Revised 2026 PDS output', async () => {
      const employeeOrigin = { origin: new URL(ownerContext.page.url()).origin };
      const documents = await body<{
        documents: Array<{ documentId: string; documentNo: string; version: { id: string } }>;
      }>(
        await ownerContext.page.request.get(`/api/v1/agencies/${agencyId}/documents/versions`, {
          headers: employeeOrigin,
        }),
      );
      const document = documents.documents.find(
        ({ documentNo }) => documentNo === 'E2E-PDS-EVIDENCE',
      );
      if (!document) throw new Error('The finalized PDS evidence fixture is missing.');
      const pds = await body<{ id: string; formVersion: string }>(
        await ownerContext.page.request.post(`/api/v1/agencies/${agencyId}/my-pds`, {
          headers: employeeOrigin,
          data: completePds({ documentId: document.documentId, versionId: document.version.id }),
        }),
      );
      expect(pds.formVersion).toBe('CS_FORM_212_REVISED_2026');
      await body(
        await ownerContext.page.request.post(`/api/v1/agencies/${agencyId}/pds/${pds.id}/submit`, {
          headers: employeeOrigin,
          data: {},
        }),
      );
      await body(
        await ownerContext.page.request.post(
          `/api/v1/agencies/${agencyId}/my-pds/${pds.id}/certify`,
          {
            headers: employeeOrigin,
            data: { employeeCertificationAccepted: true },
          },
        ),
      );
      const verified = await body<{ status: string; hrVerifiedAt: string }>(
        await page.request.post(`/api/v1/agencies/${agencyId}/pds/${pds.id}/verify`, {
          headers: origin(),
          data: {},
        }),
      );
      expect(verified).toMatchObject({ status: 'CERTIFIED', hrVerifiedAt: expect.any(String) });
      const outputs = await body<{
        outputs: Array<{
          formVersion: string;
          sourceArtifactId: string;
          sourceArtifactHash: string;
        }>;
      }>(
        await page.request.post(`/api/v1/agencies/${agencyId}/pds/${pds.id}/render`, {
          headers: origin(),
          data: {},
        }),
      );
      expect(outputs.outputs).toHaveLength(2);
      expect(outputs.outputs.every((item) => item.formVersion === 'CS_FORM_212_REVISED_2026')).toBe(
        true,
      );
      const historical = await body<typeof outputs>(
        await ownerContext.page.request.get(
          `/api/v1/agencies/${agencyId}/my-pds/${pds.id}/outputs`,
          {
            headers: employeeOrigin,
          },
        ),
      );
      expect(historical).toEqual(outputs);
      pdsVersionId = pds.id;
    });

    const protectedValue = `TIN-P5-${suffix}`;
    let identifierId = '';
    await test.step('mask and deliberately reveal a protected government identifier', async () => {
      const created = await body<{ id: string; maskedValue: string }>(
        await page.request.post(
          `/api/v1/agencies/${agencyId}/employees/${employeeId}/government-identifiers`,
          {
            headers: origin(),
            data: {
              identifierType: 'TIN',
              value: protectedValue,
              reason: 'Phase 5 acceptance gate.',
            },
          },
        ),
      );
      identifierId = created.id;
      expect(created.maskedValue).not.toContain(protectedValue);
      const listed = await body<{ identifiers: Array<{ maskedValue: string }> }>(
        await page.request.get(
          `/api/v1/agencies/${agencyId}/employees/${employeeId}/government-identifiers`,
          {
            headers: origin(),
          },
        ),
      );
      expect(JSON.stringify(listed)).not.toContain(protectedValue);

      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`/employees/${employeeId}`);
      await page.getByRole('tab', { name: 'Government identifiers' }).click();
      await expect(page.getByText(protectedValue, { exact: true })).toHaveCount(0);
      await expect(page.getByText(created.maskedValue, { exact: true })).toBeVisible();
      const trigger = page.getByRole('button', { name: 'Reveal value' });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Reveal government identifier' });
      await expect(dialog).toHaveAccessibleDescription(
        'Record why you need the full protected value. The routine screen stays masked.',
      );
      await expect(dialog.getByLabel('Reveal reason')).toBeFocused();
      await expectCentered(dialog, 1280);
      await dialog.getByRole('button', { name: 'Reveal value' }).click();
      await expect(dialog.getByLabel('Reveal reason')).toBeFocused();
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
      await page.mouse.click(1, 1);
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();

      await page.setViewportSize({ width: 390, height: 844 });
      await trigger.click();
      await expectCentered(dialog, 390);
      await dialog.getByLabel('Reveal reason').fill('Validate the employee-provided identifier.');
      let releaseReveal!: () => void;
      const held = new Promise<void>((resolve) => {
        releaseReveal = resolve;
      });
      await page.route(`**/government-identifiers/${identifierId}/reveal`, async (route) => {
        await held;
        await route.continue();
      });
      const submit = dialog.getByRole('button', {
        name: /^(Reveal value|Revealing…|Revealing\.\.\.)$/,
      });
      await submit.click();
      await expect(submit).toBeDisabled();
      await expect(
        dialog.getByRole('button', { name: 'Close reveal government identifier dialog' }),
      ).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      releaseReveal();
      await expect(dialog).toContainText(protectedValue);
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.getByText(protectedValue, { exact: true })).toHaveCount(0);
      await page.unroute(`**/government-identifiers/${identifierId}/reveal`);
    });

    let actionId = '';
    await test.step('prepare, approve, and effectuate the supported step action', async () => {
      const documents = await body<{
        documents: Array<{ documentId: string; documentNo: string; version: { id: string } }>;
      }>(
        await page.request.get(`/api/v1/agencies/${agencyId}/documents/versions`, {
          headers: origin(),
        }),
      );
      const evidence = [
        'NOSI',
        'CURRENT_COMPENSATION',
        'PERFORMANCE_OR_SERVICE',
        'SERVICE_CONTINUITY',
      ].map((evidenceType) => {
        const document = documents.documents.find(
          ({ documentNo }) => documentNo === `E2E-ACTION-${evidenceType}`,
        );
        if (!document) throw new Error(`The ${evidenceType} evidence fixture is missing.`);
        return {
          evidenceType,
          documentId: document.documentId,
          documentVersionId: document.version.id,
          sourceDate: '2026-01-01',
        };
      });
      const ownerOrigin = { origin: new URL(ownerContext.page.url()).origin };
      const action = await body<{ id: string }>(
        await ownerContext.page.request.post(`/api/v1/agencies/${agencyId}/personnel-actions`, {
          headers: ownerOrigin,
          data: {
            employeeId,
            actionType: 'STEP_INCREMENT',
            proposedEffectivity: '2026-09-05',
            targetFacts: { newSalaryStep: 2 },
            reason: 'Apply the signed Notice of Step Increment.',
            evidence,
          },
        }),
      );
      actionId = action.id;
      await body(
        await ownerContext.page.request.post(
          `/api/v1/agencies/${agencyId}/personnel-actions/${action.id}/submit`,
          { headers: ownerOrigin, data: {} },
        ),
      );
      await body(
        await page.request.post(
          `/api/v1/agencies/${agencyId}/personnel-actions/${action.id}/review`,
          {
            headers: origin(),
            data: { decision: 'ENDORSE', reason: 'The exact evidence package was reviewed.' },
          },
        ),
      );
      await body(
        await page.request.post(
          `/api/v1/agencies/${agencyId}/personnel-actions/${action.id}/decision`,
          {
            headers: origin(),
            data: { decision: 'APPROVE', reason: 'Approved within appointing authority.' },
          },
        ),
      );
      const effective = await body<{
        status: string;
        currentVersion: { targetFacts: { newSalaryStep: number } };
      }>(
        await page.request.post(
          `/api/v1/agencies/${agencyId}/personnel-actions/${action.id}/effectuate`,
          {
            headers: { ...origin(), 'idempotency-key': `p5-action-${suffix}` },
            data: {},
          },
        ),
      );
      expect(effective).toMatchObject({
        status: 'EFFECTIVE',
        currentVersion: { targetFacts: { newSalaryStep: 2 } },
      });
    });

    let snapshotId = '';
    await test.step('generate the immutable Service Record and Printable System View', async () => {
      const record = await body<{
        id: string;
        renderingContractVersion: string;
        snapshot: unknown;
      }>(
        await page.request.post(`/api/v1/agencies/${agencyId}/service-records`, {
          headers: origin(),
          data: { employeeId, asOfDate: '2026-09-05' },
        }),
      );
      snapshotId = record.id;
      expect(record.renderingContractVersion).toBe('service-record-printable-v1');
      expect(record.snapshot).toMatchObject({
        label: 'Printable System View',
        serviceSegments: expect.arrayContaining([
          expect.objectContaining({ salaryGrade: 18, salaryStep: 2 }),
        ]),
        personnelActions: expect.arrayContaining([
          expect.objectContaining({ id: actionId, status: 'EFFECTIVE' }),
        ]),
      });
      const printable = await body<unknown>(
        await page.request.get(
          `/api/v1/agencies/${agencyId}/service-records/${record.id}/printable`,
          { headers: origin() },
        ),
      );
      const structured = await body<unknown>(
        await page.request.get(
          `/api/v1/agencies/${agencyId}/service-records/${record.id}/structured`,
          { headers: origin() },
        ),
      );
      expect(printable).toEqual(structured);
      expect(JSON.stringify({ printable, structured })).not.toContain(protectedValue);
    });

    await test.step('deny same-Agency and Cross-Agency high-risk access', async () => {
      restrictedContext = await activateInvitation(browser, phase5RestrictedToken);
      const restrictedOrigin = { origin: new URL(restrictedContext.page.url()).origin };
      const forbiddenReveal = await restrictedContext.page.request.post(
        `/api/v1/agencies/${agencyId}/employees/${employeeId}/government-identifiers/${identifierId}/reveal`,
        { headers: restrictedOrigin, data: { reason: 'This must be denied.' } },
      );
      expect(forbiddenReveal.status()).toBe(404);
      expect(await forbiddenReveal.text()).not.toContain(protectedValue);
      const forbiddenAction = await restrictedContext.page.request.post(
        `/api/v1/agencies/${agencyId}/personnel-actions/${actionId}/effectuate`,
        { headers: { ...restrictedOrigin, 'idempotency-key': `forbidden-${suffix}` }, data: {} },
      );
      expect(forbiddenAction.status()).toBe(403);

      await page.goto(`/employees/${foreignEmployeeId}`);
      await expect(
        page.getByRole('heading', { name: 'The Employee record could not be found' }),
      ).toBeVisible();
      expect(await page.locator('body').innerText()).not.toContain('foreign-protected-fixture');

      const foreignLink = await page.request.post(
        `/api/v1/agencies/${agencyId}/employees/${foreignEmployeeId}/membership-link`,
        { headers: origin(), data: { membershipId: adminSession.membershipId } },
      );
      expect(foreignLink.status()).toBe(404);
      expect(await foreignLink.text()).not.toContain('foreign-protected-fixture');
      const foreignChange = await page.request.patch(
        `/api/v1/agencies/${foreignAgencyId}/employees/${foreignEmployeeId}/government-identifiers/${foreignIdentifierId}/invalidate`,
        { headers: origin(), data: { reason: 'Cross-Agency change must be absent.' } },
      );
      expect(foreignChange.status()).toBe(404);
      expect(await foreignChange.text()).not.toContain('foreign-protected-fixture');

      for (const request of [
        page.request.get(`/api/v1/agencies/${foreignAgencyId}/employees/${foreignEmployeeId}`, {
          headers: origin(),
        }),
        page.request.get(`/api/v1/agencies/${foreignAgencyId}/service-records/${snapshotId}`, {
          headers: origin(),
        }),
        page.request.post(
          `/api/v1/agencies/${foreignAgencyId}/employees/${foreignEmployeeId}/government-identifiers/${foreignIdentifierId}/reveal`,
          {
            headers: origin(),
            data: { reason: 'Cross-Agency reveal must be absent.' },
          },
        ),
      ]) {
        const response = await request;
        expect(response.status()).toBe(404);
        const responseBody = await response.text();
        expect(responseBody).not.toContain(protectedValue);
        expect(responseBody).not.toContain('foreign-protected-fixture');
      }

      const settings = `SELECT set_config('app.agency_id','${agencyId}',true), set_config('app.user_id','${adminSession.userId}',true), set_config('app.membership_id','${adminSession.membershipId}',true)`;
      const count = execFileSync(
        'psql',
        [
          runtimeUrl,
          '-XAt',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          `BEGIN; ${settings}; SELECT count(*) FROM employees WHERE id = '${foreignEmployeeId}' UNION ALL SELECT count(*) FROM government_identifiers WHERE id = '${foreignIdentifierId}'; ROLLBACK;`,
        ],
        { encoding: 'utf8' },
      );
      expect(
        count
          .trim()
          .split('\n')
          .filter((line) => /^\d+$/.test(line)),
      ).toEqual(['0', '0']);
      expect(() =>
        execFileSync(
          'psql',
          [
            runtimeUrl,
            '-XAt',
            '-v',
            'ON_ERROR_STOP=1',
            '-c',
            `BEGIN; ${settings}; SELECT set_config('app.employee_membership_link','on',true); UPDATE agency_memberships SET employee_id = '${foreignEmployeeId}' WHERE id = '${adminSession.membershipId}'; ROLLBACK;`,
          ],
          { encoding: 'utf8', stdio: 'pipe' },
        ),
      ).toThrow();
    });

    await test.step('inspect sanitized Audit Events for every material transition', async () => {
      const settings = `SELECT set_config('app.agency_id','${agencyId}',true), set_config('app.user_id','${adminSession.userId}',true), set_config('app.membership_id','${adminSession.membershipId}',true)`;
      const auditRows = execFileSync(
        'psql',
        [
          runtimeUrl,
          '-XAt',
          '-F',
          '\t',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          `BEGIN; ${settings}; SELECT action, entity_id, metadata::text FROM audit_events WHERE agency_id = '${agencyId}' AND entity_id IN ('${employeeId}', '${baselineId}', '${pdsVersionId}', '${identifierId}', '${actionId}', '${snapshotId}') ORDER BY occurred_at; ROLLBACK;`,
        ],
        { encoding: 'utf8', stdio: 'pipe' },
      );
      const actions = new Set(auditRows.split('\n').map((row) => row.split('\t')[0]));
      for (const action of [
        'EMPLOYEE_CREATED',
        'EMPLOYEE_MEMBERSHIP_LINKED',
        'PERSONNEL_BASELINE_PREPARED',
        'PERSONNEL_BASELINE_SUBMITTED',
        'PERSONNEL_BASELINE_REVIEWED',
        'PERSONNEL_BASELINE_EFFECTUATED',
        'PDS_VERSION_CREATED',
        'PDS_SUBMITTED',
        'PDS_EMPLOYEE_CERTIFIED',
        'PDS_HR_VERIFIED',
        'PDS_OUTPUT_RENDERED',
        'GOVERNMENT_IDENTIFIER_CREATED',
        'GOVERNMENT_IDENTIFIER_REVEAL_ATTEMPTED',
        'PERSONNEL_ACTION_PREPARED',
        'PERSONNEL_ACTION_SUBMITTED',
        'PERSONNEL_ACTION_ENDORSED',
        'PERSONNEL_ACTION_APPROVED',
        'PERSONNEL_ACTION_EFFECTUATED',
        'SERVICE_RECORD_GENERATED',
        'SERVICE_RECORD_ACCESSED',
      ])
        expect(actions, `Missing ${action}`).toContain(action);
      expect(auditRows).not.toContain(protectedValue);
      expect(auditRows).toContain(employeeId);
      expect(auditRows).toContain(baselineId);
      expect(auditRows).toContain(pdsVersionId);
      expect(auditRows).toContain(identifierId);
      expect(auditRows).toContain(actionId);
      expect(auditRows).toContain(snapshotId);
    });
  } finally {
    await ownerContext?.context.close();
    await restrictedContext?.context.close();
    resetFixture();
  }
});
