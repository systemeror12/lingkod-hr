import { describe, expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { requestDatabaseContext } from './database-context';

const context = {
  agencyId: 'agency-1',
  userId: 'user-1',
  membershipId: 'membership-1',
} as RequestContext;

describe('requestDatabaseContext', () => {
  it('keeps request identity and adds only requested capabilities', () => {
    expect(requestDatabaseContext(context)).toEqual({
      agencyId: 'agency-1',
      userId: 'user-1',
      membershipId: 'membership-1',
    });
    expect(requestDatabaseContext(context, 'pds-mutation')).toEqual({
      agencyId: 'agency-1',
      userId: 'user-1',
      membershipId: 'membership-1',
      capabilities: ['pds-mutation'],
    });
  });
});
