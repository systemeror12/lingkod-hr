import { describe, expect, it } from 'vitest';
import { blankWes, blankWorkExperience, formFromDetail, formPayload, moveAt } from './pds-editor';

describe('PDS editor model', () => {
  it('keeps row ordering and serializes WES links against the current work sequence', () => {
    const first = { ...blankWorkExperience(), positionTitle: 'First role' };
    const second = { ...blankWorkExperience(), positionTitle: 'Second role' };
    const wes = blankWes();
    wes.entries[0] = {
      ...wes.entries[0]!,
      workExperienceKey: first.uiKey,
      durationText: '  2024  ',
      position: '  Officer  ',
      officeUnit: '  HR  ',
      immediateSupervisor: '  Director  ',
      agencyOrganizationLocation: '  Manila  ',
      actualDuties: '  Records  ',
    };
    const form = {
      ...formFromDetail(null),
      workExperience: moveAt([first, second], 0, 1),
      wes: [wes],
    };

    const payload = formPayload(form);

    expect(payload.workExperience.map((row) => row.positionTitle)).toEqual([
      'Second role',
      'First role',
    ]);
    expect(payload.wes[0]?.entries[0]).toMatchObject({
      workExperienceSequenceNo: 2,
      durationText: '2024',
      position: 'Officer',
      officeUnit: 'HR',
      immediateSupervisor: 'Director',
      agencyOrganizationLocation: 'Manila',
      actualDuties: 'Records',
    });
  });
});
