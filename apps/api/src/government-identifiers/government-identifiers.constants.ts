export const GOVERNMENT_IDENTIFIER_TYPES = [
  'UMID',
  'PAGIBIG',
  'PHILHEALTH',
  'PHILSYS_PCN',
  'TIN',
] as const;
export type GovernmentIdentifierType = (typeof GOVERNMENT_IDENTIFIER_TYPES)[number];

export const GOVERNMENT_IDENTIFIER_STATUSES = ['ACTIVE', 'REPLACED', 'INVALID'] as const;
export type GovernmentIdentifierStatus = (typeof GOVERNMENT_IDENTIFIER_STATUSES)[number];
