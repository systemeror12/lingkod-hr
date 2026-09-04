export interface PdsVersionSummaryData {
  id: string;
  employeeId: string;
  versionNo: number;
  formVersion: string;
  asOfDate: string;
  status: string;
  supersedesVersionId: string | null;
  correctionReason: string | null;
  createdByMembershipId: string;
  createdAt: string;
  updatedByMembershipId: string;
  updatedAt: string;
  rowVersion: number;
  fieldScope: 'FULL' | 'REDACTED';
}

export interface PdsVersionListData {
  employeeId: string;
  citizenshipCountries: readonly string[];
  current: PdsVersionSummaryData | null;
  draft: PdsVersionSummaryData | null;
  versions: PdsVersionSummaryData[];
}

export interface PdsAddressData {
  houseBlockLotNo: string | null;
  street: string | null;
  subdivisionVillage: string | null;
  barangay: string | null;
  cityMunicipality: string | null;
  province: string | null;
  zipCode: string | null;
}

export interface PdsPersonalData {
  surname: string | null;
  firstName: string | null;
  nameExtension: string | null;
  middleName: string | null;
  birthDate: string | null;
  birthPlace: string | null;
  sex: string | null;
  civilStatus: string | null;
  civilStatusDetail: string | null;
  heightMeters: number | null;
  weightKilograms: number | null;
  bloodType: string | null;
  citizenship: string | null;
  dualCitizenshipType: string | null;
  dualCitizenshipCountry: string | null;
  residentialAddress: PdsAddressData | null;
  permanentAddress: PdsAddressData | null;
  telephoneNumber: string | null;
  mobileNumber: string | null;
  emailAddress: string | null;
}

export interface PdsFamilyRecordData {
  id: string;
  relationshipType: 'SPOUSE' | 'CHILD' | 'FATHER' | 'MOTHER';
  sequenceNo: number;
  fullName: string | null;
  surname: string | null;
  firstName: string | null;
  middleName: string | null;
  nameExtension: string | null;
  birthDate: string | null;
  occupation: string | null;
  employerBusinessName: string | null;
  businessAddress: PdsAddressData | null;
  telephoneNumber: string | null;
}

export interface PdsFamilyData {
  spouse: PdsFamilyRecordData | null;
  children: PdsFamilyRecordData[];
  father: PdsFamilyRecordData | null;
  mother: PdsFamilyRecordData | null;
}

export interface PdsEvidenceData {
  documentId: string | null;
  documentVersionId: string | null;
}

export interface PdsEvidenceOption {
  documentId: string;
  documentNo: string | null;
  documentType: string;
  version: { id: string; versionNo: number };
}

export interface PdsEducationRecordData {
  id?: string;
  sequenceNo: number;
  level: string | null;
  schoolName: string | null;
  degreeCourse: string | null;
  periodOfAttendance: string | null;
  highestLevelUnits: string | null;
  yearGraduated: number | null;
  honors: string | null;
  documentId: string | null;
  documentVersionId: string | null;
}

export interface PdsEligibilityRecordData {
  id?: string;
  sequenceNo: number;
  eligibilityName: string | null;
  rating: string | null;
  examDate: string | null;
  examPlace: string | null;
  licenseNo: string | null;
  validUntil: string | null;
  documentId: string | null;
  documentVersionId: string | null;
}

export interface PdsWorkExperienceData extends PdsEvidenceData {
  id?: string;
  sequenceNo: number;
  inclusiveFrom: string | null;
  inclusiveTo: string | null;
  positionTitle: string | null;
  departmentAgencyOfficeCompany: string | null;
  monthlySalary: number | null;
  salaryGradeStep: string | null;
  appointmentStatus: string | null;
  governmentService: 'Y' | 'N' | null;
  isCurrent?: boolean;
}

export interface PdsVoluntaryWorkData extends PdsEvidenceData {
  id?: string;
  sequenceNo: number;
  organizationNameAddress: string | null;
  inclusiveFrom: string | null;
  inclusiveTo: string | null;
  hours: number | null;
  positionNatureOfWork: string | null;
}

export interface PdsLearningDevelopmentData extends PdsEvidenceData {
  id?: string;
  sequenceNo: number;
  interventionTitle: string | null;
  attendanceFrom: string | null;
  attendanceTo: string | null;
  hours: number | null;
  type: string | null;
  conductedSponsoredBy: string | null;
}

export interface PdsWesEntryData {
  id?: string;
  workExperienceId?: string;
  workExperienceSequenceNo?: number;
  sequenceNo: number;
  durationText: string;
  position: string | null;
  officeUnit: string | null;
  immediateSupervisor: string | null;
  agencyOrganizationLocation: string | null;
  accomplishments: string | null;
  actualDuties: string | null;
}

export interface PdsWesData extends PdsEvidenceData {
  id?: string;
  contextKey: string | null;
  signatureDocumentId?: string | null;
  signatureDocumentVersionId?: string | null;
  signedAt?: string | null;
  entries: PdsWesEntryData[];
}

export interface PdsOtherInformationData {
  skillsAndHobbies?: string | null;
  nonAcademicDistinctions?: string | null;
  associationMemberships?: string | null;
}

export interface PdsDeclarationData {
  relatedWithinThirdDegree?: boolean | null;
  relatedWithinFourthDegreeLgu?: boolean | null;
  relationshipDetails?: string | null;
  relatedWithinFourthDegreeDetails?: string | null;
  foundGuiltyAdministrativeOffense?: boolean | null;
  administrativeOffenseDetails?: string | null;
  criminallyCharged?: boolean | null;
  criminalChargeDetails?: string | null;
  criminalChargeDateFiled?: string | null;
  criminalChargeDateFiledUnknown?: boolean | null;
  criminalChargeStatus?: string | null;
  convictedOfCrime?: boolean | null;
  convictionDetails?: string | null;
  separatedFromService?: boolean | null;
  separationMode?: string | null;
  separationDetails?: string | null;
  candidateInLastElection?: boolean | null;
  candidacyDetails?: string | null;
  resignedBeforeElection?: boolean | null;
  resignationDetails?: string | null;
  immigrantOrPermanentResident?: boolean | null;
  immigrantCountry?: string | null;
  immigrantDetails?: string | null;
  indigenousGroupMember?: boolean | null;
  indigenousGroupDetails?: string | null;
  personWithDisability?: boolean | null;
  disabilitySpecification?: string | null;
  disabilityIdNumber?: string | null;
  soloParent?: boolean | null;
  soloParentSpecification?: string | null;
  soloParentIdNumber?: string | null;
}

export interface PdsReferenceData {
  id?: string;
  sequenceNo: number;
  name: string | null;
  address: string | null;
  contact: string | null;
}

export interface PdsPageSignatureData {
  pageKey: string;
  signatureDocumentId: string | null;
  signatureDocumentVersionId: string | null;
  signedAt: string | null;
  signatureDate: string | null;
}

export interface PdsCertificationData {
  truthDeclarationAccepted?: boolean | null;
  verificationAuthorizationAccepted?: boolean | null;
  misrepresentationWarningAccepted?: boolean | null;
  governmentIdType?: string | null;
  governmentIdNumber?: string | null;
  governmentIdIssuedAt?: string | null;
  governmentIdIssuedPlace?: string | null;
  photoDocumentId?: string | null;
  photoDocumentVersionId?: string | null;
  employeeSignatureDocumentId?: string | null;
  employeeSignatureDocumentVersionId?: string | null;
  employeeSignatureDate?: string | null;
  thumbmarkDocumentId?: string | null;
  thumbmarkDocumentVersionId?: string | null;
  subscribedAndSwornText?: string | null;
  subscribedAndSwornAt?: string | null;
  oathAdministeredBy?: string | null;
  oathAdminSignatureDocumentId?: string | null;
  oathAdminSignatureDocumentVersionId?: string | null;
  oathAdministeredAt?: string | null;
}

export interface PdsDetailData extends PdsVersionSummaryData {
  personal: PdsPersonalData | null;
  family: PdsFamilyData;
  education?: PdsEducationRecordData[];
  eligibility?: PdsEligibilityRecordData[];
  workExperience?: PdsWorkExperienceData[];
  voluntaryWork?: PdsVoluntaryWorkData[];
  learningAndDevelopment?: PdsLearningDevelopmentData[];
  wes?: PdsWesData[] | null;
  otherInformation?: PdsOtherInformationData | null;
  declarations?: PdsDeclarationData | null;
  references?: PdsReferenceData[] | null;
  certification?: PdsCertificationData | null;
  pageSignatures?: PdsPageSignatureData[] | null;
}

export interface PdsDetailSections {
  workExperience: PdsWorkExperienceData[];
  voluntaryWork: PdsVoluntaryWorkData[];
  learningAndDevelopment: PdsLearningDevelopmentData[];
  wes: PdsWesData[];
}

export interface AddressForm {
  houseBlockLotNo: string;
  street: string;
  subdivisionVillage: string;
  barangay: string;
  cityMunicipality: string;
  province: string;
  zipCode: string;
}

export interface NameForm {
  surname: string;
  firstName: string;
  middleName: string;
  nameExtension: string;
}

export interface EvidenceForm {
  documentId: string;
  documentVersionId: string;
}

export interface SpouseForm extends NameForm {
  occupation: string;
  employerBusinessName: string;
  businessAddress: AddressForm;
  telephoneNumber: string;
}

export interface ChildForm {
  uiKey: string;
  fullName: string;
  birthDate: string;
}

export interface WorkExperienceForm extends EvidenceForm {
  uiKey: string;
  id: string;
  inclusiveFrom: string;
  inclusiveTo: string;
  positionTitle: string;
  departmentAgencyOfficeCompany: string;
  monthlySalary: string;
  salaryGradeStep: string;
  appointmentStatus: string;
  governmentService: string;
  isCurrent: boolean;
}

export interface VoluntaryWorkForm extends EvidenceForm {
  uiKey: string;
  id: string;
  organizationNameAddress: string;
  inclusiveFrom: string;
  inclusiveTo: string;
  hours: string;
  positionNatureOfWork: string;
}

export interface LearningDevelopmentForm extends EvidenceForm {
  uiKey: string;
  id: string;
  interventionTitle: string;
  attendanceFrom: string;
  attendanceTo: string;
  hours: string;
  type: string;
  conductedSponsoredBy: string;
}

export interface WesEntryForm {
  uiKey: string;
  id: string;
  workExperienceKey: string;
  durationText: string;
  position: string;
  officeUnit: string;
  immediateSupervisor: string;
  agencyOrganizationLocation: string;
  accomplishments: string;
  actualDuties: string;
}

export interface WesForm extends EvidenceForm {
  uiKey: string;
  id: string;
  contextKey: string;
  signatureDocumentId: string;
  signatureDocumentVersionId: string;
  signedAt: string;
  entries: WesEntryForm[];
}

export interface OtherInformationForm {
  specialSkillsHobbies: string;
  nonAcademicDistinctions: string;
  memberships: string;
}

export type DeclarationKey =
  | 'relatedThirdDegree'
  | 'relatedThirdDegreeDetails'
  | 'relatedFourthDegree'
  | 'relatedFourthDegreeDetails'
  | 'administrativeCase'
  | 'administrativeCaseDetails'
  | 'criminalCharge'
  | 'criminalChargeDetails'
  | 'criminalChargeDateFiled'
  | 'criminalChargeDateFiledUnknown'
  | 'criminalChargeStatus'
  | 'conviction'
  | 'convictionDetails'
  | 'separatedFromService'
  | 'separationMode'
  | 'separatedFromServiceDetails'
  | 'electionCandidate'
  | 'electionCandidateDetails'
  | 'resignedForElection'
  | 'resignedForElectionDetails'
  | 'immigrant'
  | 'immigrantCountry'
  | 'immigrantDetails'
  | 'indigenousGroup'
  | 'indigenousGroupDetails'
  | 'disability'
  | 'disabilityIdNumber'
  | 'disabilityDetails'
  | 'soloParent'
  | 'soloParentDetails'
  | 'soloParentIdNumber';

export type DeclarationForm = Record<DeclarationKey, string>;

export interface ReferenceForm {
  uiKey: string;
  id: string;
  name: string;
  address: string;
  telephoneNumber: string;
}

export interface PageSignatureForm {
  pageNo: number;
  signatureDocumentId: string;
  signatureDocumentVersionId: string;
  signedAt: string;
}

export interface CertificationForm {
  truthDeclarationAccepted: boolean;
  verificationAuthorizationAccepted: boolean;
  misrepresentationWarningAccepted: boolean;
  governmentIdType: string;
  governmentIdNumber: string;
  governmentIdIssuedDate: string;
  governmentIdIssuedPlace: string;
  photoDocumentId: string;
  photoDocumentVersionId: string;
  signatureDocumentId: string;
  signatureDocumentVersionId: string;
  employeeSignatureDate: string;
  thumbmarkDocumentId: string;
  thumbmarkDocumentVersionId: string;
  subscribedAndSwornText: string;
  oathDate: string;
  oathAdministeredBy: string;
  oathAdminSignatureDocumentId: string;
  oathAdminSignatureDocumentVersionId: string;
  oathAdministeredAt: string;
  pageSignatures: PageSignatureForm[];
}

export interface EducationForm {
  level: string;
  schoolName: string;
  degreeCourse: string;
  periodOfAttendance: string;
  highestLevelUnits: string;
  yearGraduated: string;
  honors: string;
  documentId: string;
  documentVersionId: string;
}

export interface EligibilityForm {
  eligibilityName: string;
  rating: string;
  examDate: string;
  examPlace: string;
  licenseNo: string;
  validUntil: string;
  documentId: string;
  documentVersionId: string;
}

export interface PersonalForm {
  surname: string;
  firstName: string;
  nameExtension: string;
  middleName: string;
  birthDate: string;
  birthPlace: string;
  sex: string;
  civilStatus: string;
  civilStatusDetail: string;
  heightMeters: string;
  weightKilograms: string;
  bloodType: string;
  citizenship: string;
  dualCitizenshipType: string;
  dualCitizenshipCountry: string;
  residentialAddress: AddressForm;
  permanentAddress: AddressForm;
  telephoneNumber: string;
  mobileNumber: string;
  emailAddress: string;
}

export interface PdsForm {
  asOfDate: string;
  personal: PersonalForm;
  spouse: SpouseForm;
  children: ChildForm[];
  father: NameForm;
  mother: NameForm;
  education: EducationForm[];
  eligibility: EligibilityForm[];
  workExperience: WorkExperienceForm[];
  voluntaryWork: VoluntaryWorkForm[];
  learningAndDevelopment: LearningDevelopmentForm[];
  wes: WesForm[];
  otherInformation: OtherInformationForm;
  declarations: DeclarationForm;
  references: ReferenceForm[];
  certification: CertificationForm;
}

export const yesNoOptions = [
  ['NO', 'No'],
  ['YES', 'Yes'],
] as const satisfies readonly (readonly [string, string])[];

export const declarationFields = [
  ['relatedThirdDegree', '34.a Related within the third degree?', 'relatedThirdDegreeDetails'],
  ['relatedFourthDegree', '34.b Related within the fourth degree?', 'relatedFourthDegreeDetails'],
  [
    'administrativeCase',
    '35.a Found guilty of an administrative offense?',
    'administrativeCaseDetails',
  ],
  ['criminalCharge', '35.b Criminally charged before any court?', 'criminalChargeDetails'],
  ['conviction', '36 Convicted of any crime?', 'convictionDetails'],
  ['separatedFromService', '37 Separated from service?', 'separatedFromServiceDetails'],
  ['electionCandidate', '38.a Candidate in an election?', 'electionCandidateDetails'],
  ['resignedForElection', '38.b Resigned for an election campaign?', 'resignedForElectionDetails'],
  ['immigrant', '39 Immigrant or permanent resident of another country?', 'immigrantDetails'],
  ['indigenousGroup', '40.a Indigenous group member?', 'indigenousGroupDetails'],
  ['disability', '40.b Person with disability?', 'disabilityDetails'],
  ['soloParent', '40.c Solo parent?', 'soloParentDetails'],
] as const satisfies readonly (readonly [DeclarationKey, string, DeclarationKey])[];

const declarationAnswerKeys = {
  relatedThirdDegree: 'relatedWithinThirdDegree',
  relatedFourthDegree: 'relatedWithinFourthDegreeLgu',
  administrativeCase: 'foundGuiltyAdministrativeOffense',
  criminalCharge: 'criminallyCharged',
  conviction: 'convictedOfCrime',
  separatedFromService: 'separatedFromService',
  electionCandidate: 'candidateInLastElection',
  resignedForElection: 'resignedBeforeElection',
  immigrant: 'immigrantOrPermanentResident',
  indigenousGroup: 'indigenousGroupMember',
  disability: 'personWithDisability',
  soloParent: 'soloParent',
} as const;

const declarationDetailKeys = {
  relatedThirdDegreeDetails: 'relationshipDetails',
  relatedFourthDegreeDetails: 'relatedWithinFourthDegreeDetails',
  administrativeCaseDetails: 'administrativeOffenseDetails',
  criminalChargeDetails: 'criminalChargeDetails',
  convictionDetails: 'convictionDetails',
  separatedFromServiceDetails: 'separationDetails',
  electionCandidateDetails: 'candidacyDetails',
  resignedForElectionDetails: 'resignationDetails',
  immigrantDetails: 'immigrantDetails',
  indigenousGroupDetails: 'indigenousGroupDetails',
  disabilityDetails: 'disabilitySpecification',
  soloParentDetails: 'soloParentSpecification',
} as const;

const pdsMainPageKeys = ['C1', 'C2', 'C3', 'C4'] as const;
export const pdsPageKeys = [
  ...pdsMainPageKeys,
  'C5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'C11',
] as const;
export type PdsPageKey = (typeof pdsPageKeys)[number];

const addressKeys = [
  'houseBlockLotNo',
  'street',
  'subdivisionVillage',
  'barangay',
  'cityMunicipality',
  'province',
  'zipCode',
] as const satisfies readonly (keyof AddressForm)[];

let rowKeySeed = 0;

function createRowKey(prefix: string): string {
  rowKeySeed += 1;
  return `${prefix}-${rowKeySeed}`;
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function stringValue(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

export function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function yesNoValue(value: boolean | null | undefined): string {
  return value === true ? 'YES' : 'NO';
}

function booleanPayload(value: string): boolean | null {
  if (value === 'YES') return true;
  if (value === 'NO') return false;
  return null;
}

function dateTimePayload(value: string): string | null {
  const trimmed = nullable(value);
  return trimmed ? `${trimmed}T00:00:00.000+08:00` : null;
}

export function parsePdsEvidenceOptions(value: unknown): PdsEvidenceOption[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { documents?: unknown }).documents)
  ) {
    throw new Error('The Agency Document response was invalid.');
  }
  return (value as { documents: PdsEvidenceOption[] }).documents;
}

function optionalId(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalIdPayload(value: string): { id?: string } {
  const id = optionalId(value);
  return id ? { id } : {};
}

function numberValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function addressForm(value: PdsAddressData | null | undefined): AddressForm {
  return {
    houseBlockLotNo: stringValue(value?.houseBlockLotNo),
    street: stringValue(value?.street),
    subdivisionVillage: stringValue(value?.subdivisionVillage),
    barangay: stringValue(value?.barangay),
    cityMunicipality: stringValue(value?.cityMunicipality),
    province: stringValue(value?.province),
    zipCode: stringValue(value?.zipCode),
  };
}

export function blankAddress(): AddressForm {
  return {
    houseBlockLotNo: '',
    street: '',
    subdivisionVillage: '',
    barangay: '',
    cityMunicipality: '',
    province: '',
    zipCode: '',
  };
}

export function blankName(): NameForm {
  return { surname: '', firstName: '', middleName: '', nameExtension: '' };
}

function blankEvidence(): EvidenceForm {
  return { documentId: '', documentVersionId: '' };
}

export function blankSpouse(): SpouseForm {
  return {
    ...blankName(),
    occupation: '',
    employerBusinessName: '',
    businessAddress: blankAddress(),
    telephoneNumber: '',
  };
}

export function blankPersonal(): PersonalForm {
  return {
    surname: '',
    firstName: '',
    nameExtension: '',
    middleName: '',
    birthDate: '',
    birthPlace: '',
    sex: '',
    civilStatus: '',
    civilStatusDetail: '',
    heightMeters: '',
    weightKilograms: '',
    bloodType: '',
    citizenship: '',
    dualCitizenshipType: '',
    dualCitizenshipCountry: '',
    residentialAddress: blankAddress(),
    permanentAddress: blankAddress(),
    telephoneNumber: '',
    mobileNumber: '',
    emailAddress: '',
  };
}

export function blankChild(): ChildForm {
  return { uiKey: createRowKey('child'), fullName: '', birthDate: '' };
}

export function blankWorkExperience(): WorkExperienceForm {
  return {
    uiKey: createRowKey('work'),
    id: '',
    inclusiveFrom: '',
    inclusiveTo: '',
    positionTitle: '',
    departmentAgencyOfficeCompany: '',
    monthlySalary: '',
    salaryGradeStep: '',
    appointmentStatus: '',
    governmentService: '',
    isCurrent: false,
    ...blankEvidence(),
  };
}

export function blankVoluntaryWork(): VoluntaryWorkForm {
  return {
    uiKey: createRowKey('voluntary'),
    id: '',
    organizationNameAddress: '',
    inclusiveFrom: '',
    inclusiveTo: '',
    hours: '',
    positionNatureOfWork: '',
    ...blankEvidence(),
  };
}

export function blankLearningDevelopment(): LearningDevelopmentForm {
  return {
    uiKey: createRowKey('learning'),
    id: '',
    interventionTitle: '',
    attendanceFrom: '',
    attendanceTo: '',
    hours: '',
    type: '',
    conductedSponsoredBy: '',
    ...blankEvidence(),
  };
}

export function blankWes(): WesForm {
  return {
    uiKey: createRowKey('wes'),
    id: '',
    contextKey: '',
    signatureDocumentId: '',
    signatureDocumentVersionId: '',
    signedAt: '',
    entries: [blankWesEntry()],
    ...blankEvidence(),
  };
}

function blankOtherInformation(): OtherInformationForm {
  return { specialSkillsHobbies: '', nonAcademicDistinctions: '', memberships: '' };
}

function blankDeclarations(): DeclarationForm {
  return Object.fromEntries([
    ...declarationFields.flatMap(([key, , detailsKey]) => [
      [key, 'NO'],
      [detailsKey, ''],
    ]),
    ['criminalChargeDateFiled', ''],
    ['criminalChargeDateFiledUnknown', 'NO'],
    ['criminalChargeStatus', ''],
    ['separationMode', ''],
    ['immigrantCountry', ''],
    ['disabilityIdNumber', ''],
    ['soloParentIdNumber', ''],
  ]) as DeclarationForm;
}

export function blankReference(): ReferenceForm {
  return { uiKey: createRowKey('reference'), id: '', name: '', address: '', telephoneNumber: '' };
}

function pageKeysForDetail(detail: PdsDetailData | null): PdsPageKey[] {
  const keys: PdsPageKey[] = [...pdsMainPageKeys];
  if ((detail?.family?.children.length ?? 0) > 4) keys.push('C5');
  if ((detail?.education?.length ?? 0) > 5) keys.push('C6');
  if ((detail?.eligibility?.length ?? 0) > 7) keys.push('C7');
  if ((detail?.workExperience?.length ?? 0) > 28) keys.push('C8');
  if ((detail?.voluntaryWork?.length ?? 0) > 7) keys.push('C9');
  if ((detail?.learningAndDevelopment?.length ?? 0) > 21) keys.push('C10');
  if (
    (detail?.otherInformation?.skillsAndHobbies?.length ?? 0) > 500 ||
    (detail?.otherInformation?.nonAcademicDistinctions?.length ?? 0) > 500 ||
    (detail?.otherInformation?.associationMemberships?.length ?? 0) > 500
  ) {
    keys.push('C11');
  }
  const signedPageKeys = new Set(
    (detail?.pageSignatures ?? []).map((signature) => signature.pageKey as PdsPageKey),
  );
  return pdsPageKeys.filter((pageKey) => keys.includes(pageKey) || signedPageKeys.has(pageKey));
}

export function pageKeysForForm(form: PdsForm): PdsPageKey[] {
  const keys: PdsPageKey[] = [...pdsMainPageKeys];
  if (form.children.length > 4) keys.push('C5');
  if (form.education.length > 5) keys.push('C6');
  if (form.eligibility.length > 7) keys.push('C7');
  if (form.workExperience.length > 28) keys.push('C8');
  if (form.voluntaryWork.length > 7) keys.push('C9');
  if (form.learningAndDevelopment.length > 21) keys.push('C10');
  if (
    form.otherInformation.specialSkillsHobbies.length > 500 ||
    form.otherInformation.nonAcademicDistinctions.length > 500 ||
    form.otherInformation.memberships.length > 500
  ) {
    keys.push('C11');
  }
  return keys;
}

export function blankPageSignature(pageKey: PdsPageKey): PageSignatureForm {
  return {
    pageNo: pdsPageKeys.indexOf(pageKey) + 1,
    signatureDocumentId: '',
    signatureDocumentVersionId: '',
    signedAt: '',
  };
}

function blankCertification(pageKeys: readonly PdsPageKey[] = pdsMainPageKeys): CertificationForm {
  return {
    truthDeclarationAccepted: false,
    verificationAuthorizationAccepted: false,
    misrepresentationWarningAccepted: false,
    governmentIdType: '',
    governmentIdNumber: '',
    governmentIdIssuedDate: '',
    governmentIdIssuedPlace: '',
    photoDocumentId: '',
    photoDocumentVersionId: '',
    signatureDocumentId: '',
    signatureDocumentVersionId: '',
    employeeSignatureDate: '',
    thumbmarkDocumentId: '',
    thumbmarkDocumentVersionId: '',
    subscribedAndSwornText: '',
    oathDate: '',
    oathAdministeredBy: '',
    oathAdminSignatureDocumentId: '',
    oathAdminSignatureDocumentVersionId: '',
    oathAdministeredAt: '',
    pageSignatures: pageKeys.map(blankPageSignature),
  };
}

export function blankWesEntry(): WesEntryForm {
  return {
    uiKey: createRowKey('wes-entry'),
    id: '',
    workExperienceKey: '',
    durationText: '',
    position: '',
    officeUnit: '',
    immediateSupervisor: '',
    agencyOrganizationLocation: '',
    accomplishments: '',
    actualDuties: '',
  };
}

function evidencePayload(value: EvidenceForm) {
  return {
    documentId: nullable(value.documentId),
    documentVersionId: nullable(value.documentVersionId),
  };
}

function addressPayload(value: AddressForm): PdsAddressData {
  return Object.fromEntries(
    addressKeys.map((key) => [key, nullable(value[key])]),
  ) as unknown as PdsAddressData;
}

function namePayload(value: NameForm, includeNameExtension = true) {
  return {
    surname: nullable(value.surname),
    firstName: nullable(value.firstName),
    middleName: nullable(value.middleName),
    ...(includeNameExtension ? { nameExtension: nullable(value.nameExtension) } : {}),
  };
}

export function updateAt<T>(items: readonly T[], index: number, updater: (item: T) => T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? updater(item) : item));
}

export function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

export function moveAt<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (!item) return [...items];
  next.splice(target, 0, item);
  return next;
}

function workKeyMaps(
  rows: readonly WorkExperienceForm[],
  sourceRows: readonly PdsWorkExperienceData[] = [],
) {
  const byId = new Map<string, string>();
  const bySequence = new Map<number, string>();
  rows.forEach((row, index) => {
    const id = optionalId(row.id);
    if (id) byId.set(id, row.uiKey);
    bySequence.set(sourceRows[index]?.sequenceNo ?? index + 1, row.uiKey);
  });
  return { byId, bySequence };
}

export function blankEducation(): EducationForm {
  return {
    level: '',
    schoolName: '',
    degreeCourse: '',
    periodOfAttendance: '',
    highestLevelUnits: '',
    yearGraduated: '',
    honors: '',
    documentId: '',
    documentVersionId: '',
  };
}

export function blankEligibility(): EligibilityForm {
  return {
    eligibilityName: '',
    rating: '',
    examDate: '',
    examPlace: '',
    licenseNo: '',
    validUntil: '',
    documentId: '',
    documentVersionId: '',
  };
}

export function formFromDetail(detail: PdsDetailData | null): PdsForm {
  const workExperience = (detail?.workExperience ?? []).map((row) => ({
    uiKey: createRowKey('work'),
    id: row.id ?? '',
    inclusiveFrom: stringValue(row.inclusiveFrom),
    inclusiveTo: stringValue(row.inclusiveTo),
    positionTitle: stringValue(row.positionTitle),
    departmentAgencyOfficeCompany: stringValue(row.departmentAgencyOfficeCompany),
    monthlySalary: stringValue(row.monthlySalary),
    salaryGradeStep: stringValue(row.salaryGradeStep),
    appointmentStatus: stringValue(row.appointmentStatus),
    governmentService: stringValue(row.governmentService),
    isCurrent: Boolean(row.isCurrent),
    documentId: stringValue(row.documentId),
    documentVersionId: stringValue(row.documentVersionId),
  }));
  const workKeys = workKeyMaps(workExperience, detail?.workExperience ?? []);
  const personal = detail?.personal;
  const pageKeys = pageKeysForDetail(detail);

  return {
    asOfDate: detail?.asOfDate ?? today(),
    personal: {
      ...blankPersonal(),
      surname: stringValue(personal?.surname),
      firstName: stringValue(personal?.firstName),
      nameExtension: stringValue(personal?.nameExtension),
      middleName: stringValue(personal?.middleName),
      birthDate: stringValue(personal?.birthDate),
      birthPlace: stringValue(personal?.birthPlace),
      sex: stringValue(personal?.sex),
      civilStatus: stringValue(personal?.civilStatus),
      civilStatusDetail: stringValue(personal?.civilStatusDetail),
      heightMeters: stringValue(personal?.heightMeters),
      weightKilograms: stringValue(personal?.weightKilograms),
      bloodType: stringValue(personal?.bloodType),
      citizenship: stringValue(personal?.citizenship),
      dualCitizenshipType: stringValue(personal?.dualCitizenshipType),
      dualCitizenshipCountry: stringValue(personal?.dualCitizenshipCountry),
      residentialAddress: addressForm(personal?.residentialAddress),
      permanentAddress: addressForm(personal?.permanentAddress),
      telephoneNumber: stringValue(personal?.telephoneNumber),
      mobileNumber: stringValue(personal?.mobileNumber),
      emailAddress: stringValue(personal?.emailAddress),
    },
    spouse: detail?.family.spouse
      ? {
          ...blankSpouse(),
          surname: stringValue(detail.family.spouse.surname),
          firstName: stringValue(detail.family.spouse.firstName),
          middleName: stringValue(detail.family.spouse.middleName),
          nameExtension: stringValue(detail.family.spouse.nameExtension),
          occupation: stringValue(detail.family.spouse.occupation),
          employerBusinessName: stringValue(detail.family.spouse.employerBusinessName),
          businessAddress: addressForm(detail.family.spouse.businessAddress),
          telephoneNumber: stringValue(detail.family.spouse.telephoneNumber),
        }
      : blankSpouse(),
    children:
      detail?.family.children.map((child) => ({
        uiKey: createRowKey('child'),
        fullName: stringValue(child.fullName),
        birthDate: stringValue(child.birthDate),
      })) ?? [],
    father: detail?.family.father
      ? {
          surname: stringValue(detail.family.father.surname),
          firstName: stringValue(detail.family.father.firstName),
          middleName: stringValue(detail.family.father.middleName),
          nameExtension: stringValue(detail.family.father.nameExtension),
        }
      : blankName(),
    mother: detail?.family.mother
      ? {
          surname: stringValue(detail.family.mother.surname),
          firstName: stringValue(detail.family.mother.firstName),
          middleName: stringValue(detail.family.mother.middleName),
          nameExtension: stringValue(detail.family.mother.nameExtension),
        }
      : blankName(),
    education:
      detail?.education?.map((record) => ({
        level: stringValue(record.level),
        schoolName: stringValue(record.schoolName),
        degreeCourse: stringValue(record.degreeCourse),
        periodOfAttendance: stringValue(record.periodOfAttendance),
        highestLevelUnits: stringValue(record.highestLevelUnits),
        yearGraduated: stringValue(record.yearGraduated),
        honors: stringValue(record.honors),
        documentId: stringValue(record.documentId),
        documentVersionId: stringValue(record.documentVersionId),
      })) ?? [],
    eligibility:
      detail?.eligibility?.map((record) => ({
        eligibilityName: stringValue(record.eligibilityName),
        rating: stringValue(record.rating),
        examDate: stringValue(record.examDate),
        examPlace: stringValue(record.examPlace),
        licenseNo: stringValue(record.licenseNo),
        validUntil: stringValue(record.validUntil),
        documentId: stringValue(record.documentId),
        documentVersionId: stringValue(record.documentVersionId),
      })) ?? [],
    workExperience,
    voluntaryWork: (detail?.voluntaryWork ?? []).map((row) => ({
      uiKey: createRowKey('voluntary'),
      id: row.id ?? '',
      organizationNameAddress: stringValue(row.organizationNameAddress),
      inclusiveFrom: stringValue(row.inclusiveFrom),
      inclusiveTo: stringValue(row.inclusiveTo),
      hours: stringValue(row.hours),
      positionNatureOfWork: stringValue(row.positionNatureOfWork),
      documentId: stringValue(row.documentId),
      documentVersionId: stringValue(row.documentVersionId),
    })),
    learningAndDevelopment: (detail?.learningAndDevelopment ?? []).map((row) => ({
      uiKey: createRowKey('learning'),
      id: row.id ?? '',
      interventionTitle: stringValue(row.interventionTitle),
      attendanceFrom: stringValue(row.attendanceFrom),
      attendanceTo: stringValue(row.attendanceTo),
      hours: stringValue(row.hours),
      type: stringValue(row.type),
      conductedSponsoredBy: stringValue(row.conductedSponsoredBy),
      documentId: stringValue(row.documentId),
      documentVersionId: stringValue(row.documentVersionId),
    })),
    wes: (detail?.wes ?? []).map((artifact) => ({
      uiKey: createRowKey('wes'),
      id: artifact.id ?? '',
      contextKey: stringValue(artifact.contextKey),
      documentId: stringValue(artifact.documentId),
      documentVersionId: stringValue(artifact.documentVersionId),
      signatureDocumentId: stringValue(artifact.signatureDocumentId),
      signatureDocumentVersionId: stringValue(artifact.signatureDocumentVersionId),
      signedAt: stringValue(artifact.signedAt),
      entries: artifact.entries.map((entry) => ({
        uiKey: createRowKey('wes-entry'),
        id: entry.id ?? '',
        workExperienceKey:
          (entry.workExperienceId ? workKeys.byId.get(entry.workExperienceId) : undefined) ??
          (entry.workExperienceSequenceNo
            ? workKeys.bySequence.get(entry.workExperienceSequenceNo)
            : undefined) ??
          '',
        durationText: stringValue(entry.durationText),
        position: stringValue(entry.position),
        officeUnit: stringValue(entry.officeUnit),
        immediateSupervisor: stringValue(entry.immediateSupervisor),
        agencyOrganizationLocation: stringValue(entry.agencyOrganizationLocation),
        accomplishments: stringValue(entry.accomplishments),
        actualDuties: stringValue(entry.actualDuties),
      })),
    })),
    otherInformation: {
      ...blankOtherInformation(),
      specialSkillsHobbies: stringValue(detail?.otherInformation?.skillsAndHobbies),
      nonAcademicDistinctions: stringValue(detail?.otherInformation?.nonAcademicDistinctions),
      memberships: stringValue(detail?.otherInformation?.associationMemberships),
    },
    declarations: {
      ...blankDeclarations(),
      relatedThirdDegree: yesNoValue(detail?.declarations?.relatedWithinThirdDegree),
      relatedThirdDegreeDetails: stringValue(detail?.declarations?.relationshipDetails),
      relatedFourthDegree: yesNoValue(detail?.declarations?.relatedWithinFourthDegreeLgu),
      relatedFourthDegreeDetails: stringValue(
        detail?.declarations?.relatedWithinFourthDegreeDetails,
      ),
      administrativeCase: yesNoValue(detail?.declarations?.foundGuiltyAdministrativeOffense),
      administrativeCaseDetails: stringValue(detail?.declarations?.administrativeOffenseDetails),
      criminalCharge: yesNoValue(detail?.declarations?.criminallyCharged),
      criminalChargeDetails: stringValue(detail?.declarations?.criminalChargeDetails),
      criminalChargeDateFiled: stringValue(detail?.declarations?.criminalChargeDateFiled),
      criminalChargeDateFiledUnknown: yesNoValue(
        detail?.declarations?.criminalChargeDateFiledUnknown,
      ),
      criminalChargeStatus: stringValue(detail?.declarations?.criminalChargeStatus),
      conviction: yesNoValue(detail?.declarations?.convictedOfCrime),
      convictionDetails: stringValue(detail?.declarations?.convictionDetails),
      separatedFromService: yesNoValue(detail?.declarations?.separatedFromService),
      separationMode: stringValue(detail?.declarations?.separationMode),
      separatedFromServiceDetails: stringValue(detail?.declarations?.separationDetails),
      electionCandidate: yesNoValue(detail?.declarations?.candidateInLastElection),
      electionCandidateDetails: stringValue(detail?.declarations?.candidacyDetails),
      resignedForElection: yesNoValue(detail?.declarations?.resignedBeforeElection),
      resignedForElectionDetails: stringValue(detail?.declarations?.resignationDetails),
      immigrant: yesNoValue(detail?.declarations?.immigrantOrPermanentResident),
      immigrantCountry: stringValue(detail?.declarations?.immigrantCountry),
      immigrantDetails: stringValue(detail?.declarations?.immigrantDetails),
      indigenousGroup: yesNoValue(detail?.declarations?.indigenousGroupMember),
      indigenousGroupDetails: stringValue(detail?.declarations?.indigenousGroupDetails),
      disability: yesNoValue(detail?.declarations?.personWithDisability),
      disabilityIdNumber: stringValue(detail?.declarations?.disabilityIdNumber),
      disabilityDetails: stringValue(detail?.declarations?.disabilitySpecification),
      soloParent: yesNoValue(detail?.declarations?.soloParent),
      soloParentIdNumber: stringValue(detail?.declarations?.soloParentIdNumber),
      soloParentDetails: stringValue(detail?.declarations?.soloParentSpecification),
    } as DeclarationForm,
    references:
      detail?.references?.map((record) => ({
        uiKey: createRowKey('reference'),
        id: record.id ?? '',
        name: stringValue(record.name),
        address: stringValue(record.address),
        telephoneNumber: stringValue(record.contact),
      })) ?? [],
    certification: {
      ...blankCertification(pageKeys),
      truthDeclarationAccepted: Boolean(detail?.certification?.truthDeclarationAccepted),
      verificationAuthorizationAccepted: Boolean(
        detail?.certification?.verificationAuthorizationAccepted,
      ),
      misrepresentationWarningAccepted: Boolean(
        detail?.certification?.misrepresentationWarningAccepted,
      ),
      governmentIdType: stringValue(detail?.certification?.governmentIdType),
      governmentIdNumber: stringValue(detail?.certification?.governmentIdNumber),
      governmentIdIssuedDate: stringValue(detail?.certification?.governmentIdIssuedAt),
      governmentIdIssuedPlace: stringValue(detail?.certification?.governmentIdIssuedPlace),
      photoDocumentId: stringValue(detail?.certification?.photoDocumentId),
      photoDocumentVersionId: stringValue(detail?.certification?.photoDocumentVersionId),
      signatureDocumentId: stringValue(detail?.certification?.employeeSignatureDocumentId),
      signatureDocumentVersionId: stringValue(
        detail?.certification?.employeeSignatureDocumentVersionId,
      ),
      employeeSignatureDate: stringValue(detail?.certification?.employeeSignatureDate),
      thumbmarkDocumentId: stringValue(detail?.certification?.thumbmarkDocumentId),
      thumbmarkDocumentVersionId: stringValue(detail?.certification?.thumbmarkDocumentVersionId),
      subscribedAndSwornText: stringValue(detail?.certification?.subscribedAndSwornText),
      oathDate: stringValue(detail?.certification?.subscribedAndSwornAt?.slice(0, 10)),
      oathAdministeredBy: stringValue(detail?.certification?.oathAdministeredBy),
      oathAdminSignatureDocumentId: stringValue(
        detail?.certification?.oathAdminSignatureDocumentId,
      ),
      oathAdminSignatureDocumentVersionId: stringValue(
        detail?.certification?.oathAdminSignatureDocumentVersionId,
      ),
      oathAdministeredAt: stringValue(detail?.certification?.oathAdministeredAt?.slice(0, 10)),
      pageSignatures: pageKeys.map((pageKey) => {
        const signature = detail?.pageSignatures?.find((record) => record.pageKey === pageKey);
        return {
          pageNo: pdsPageKeys.indexOf(pageKey) + 1,
          signatureDocumentId: stringValue(signature?.signatureDocumentId),
          signatureDocumentVersionId: stringValue(signature?.signatureDocumentVersionId),
          signedAt: stringValue(signature?.signatureDate ?? signature?.signedAt?.slice(0, 10)),
        };
      }),
    },
  };
}

function educationPayload(records: EducationForm[]) {
  const nextSequence = new Map<string, number>();
  return records.map((record, index) => {
    const sequenceNo = nextSequence.get(record.level) ?? 0;
    if (record.level) nextSequence.set(record.level, sequenceNo + 1);
    return {
      sequenceNo: record.level ? sequenceNo + 1 : index + 1,
      level: record.level || null,
      schoolName: nullable(record.schoolName),
      degreeCourse: nullable(record.degreeCourse),
      periodOfAttendance: nullable(record.periodOfAttendance),
      highestLevelUnits: nullable(record.highestLevelUnits),
      yearGraduated: numberValue(record.yearGraduated),
      honors: nullable(record.honors),
      documentId: nullable(record.documentId),
      documentVersionId: nullable(record.documentVersionId),
    };
  });
}

function eligibilityPayload(records: EligibilityForm[]) {
  return records.map((record, index) => ({
    sequenceNo: index + 1,
    eligibilityName: nullable(record.eligibilityName),
    rating: nullable(record.rating),
    examDate: nullable(record.examDate),
    examPlace: nullable(record.examPlace),
    licenseNo: nullable(record.licenseNo),
    validUntil: nullable(record.validUntil),
    documentId: nullable(record.documentId),
    documentVersionId: nullable(record.documentVersionId),
  }));
}

export function formPayload(form: PdsForm) {
  const personal = form.personal;
  const spouseHasValue = Object.values(form.spouse).some((value) =>
    typeof value === 'string' ? value.trim() : Object.values(value).some(Boolean),
  );
  const fatherHasValue = Object.values(form.father).some((value) => value.trim());
  const motherHasValue = Object.values(form.mother).some((value) => value.trim());
  const workSequenceByKey = new Map(
    form.workExperience.map((row, index) => [row.uiKey, index + 1]),
  );
  const workByKey = new Map(form.workExperience.map((row) => [row.uiKey, row]));

  const payload = {
    asOfDate: form.asOfDate,
    personal: {
      surname: nullable(personal.surname),
      firstName: nullable(personal.firstName),
      nameExtension: nullable(personal.nameExtension),
      middleName: nullable(personal.middleName),
      birthDate: nullable(personal.birthDate),
      birthPlace: nullable(personal.birthPlace),
      sex: personal.sex || null,
      civilStatus: personal.civilStatus || null,
      civilStatusDetail: nullable(personal.civilStatusDetail),
      heightMeters: numberValue(personal.heightMeters),
      weightKilograms: numberValue(personal.weightKilograms),
      bloodType: nullable(personal.bloodType),
      citizenship: personal.citizenship || null,
      dualCitizenshipType: personal.dualCitizenshipType || null,
      dualCitizenshipCountry: nullable(personal.dualCitizenshipCountry),
      residentialAddress: addressPayload(personal.residentialAddress),
      permanentAddress: addressPayload(personal.permanentAddress),
      telephoneNumber: nullable(personal.telephoneNumber),
      mobileNumber: nullable(personal.mobileNumber),
      emailAddress: nullable(personal.emailAddress),
    },
    family: {
      spouse: spouseHasValue
        ? {
            ...namePayload(form.spouse),
            occupation: nullable(form.spouse.occupation),
            employerBusinessName: nullable(form.spouse.employerBusinessName),
            businessAddress: addressPayload(form.spouse.businessAddress),
            telephoneNumber: nullable(form.spouse.telephoneNumber),
          }
        : null,
      children: form.children.map((child, index) => ({
        sequenceNo: index + 1,
        fullName: nullable(child.fullName),
        birthDate: nullable(child.birthDate),
      })),
      father: fatherHasValue ? namePayload(form.father) : null,
      mother: motherHasValue ? namePayload(form.mother, false) : null,
    },
    workExperience: form.workExperience.map((row, index) => ({
      ...optionalIdPayload(row.id),
      sequenceNo: index + 1,
      inclusiveFrom: nullable(row.inclusiveFrom),
      inclusiveTo: nullable(row.inclusiveTo),
      positionTitle: nullable(row.positionTitle),
      departmentAgencyOfficeCompany: nullable(row.departmentAgencyOfficeCompany),
      monthlySalary: numberValue(row.monthlySalary),
      salaryGradeStep: nullable(row.salaryGradeStep),
      appointmentStatus: nullable(row.appointmentStatus),
      governmentService: row.governmentService || null,
      isCurrent: row.isCurrent,
      ...evidencePayload(row),
    })),
    voluntaryWork: form.voluntaryWork.map((row, index) => ({
      ...optionalIdPayload(row.id),
      sequenceNo: index + 1,
      organizationNameAddress: nullable(row.organizationNameAddress),
      inclusiveFrom: nullable(row.inclusiveFrom),
      inclusiveTo: nullable(row.inclusiveTo),
      hours: numberValue(row.hours),
      positionNatureOfWork: nullable(row.positionNatureOfWork),
      ...evidencePayload(row),
    })),
    learningAndDevelopment: form.learningAndDevelopment.map((row, index) => ({
      ...optionalIdPayload(row.id),
      sequenceNo: index + 1,
      interventionTitle: nullable(row.interventionTitle),
      attendanceFrom: nullable(row.attendanceFrom),
      attendanceTo: nullable(row.attendanceTo),
      hours: numberValue(row.hours),
      type: nullable(row.type),
      conductedSponsoredBy: nullable(row.conductedSponsoredBy),
      ...evidencePayload(row),
    })),
    wes: form.wes.map((artifact) => ({
      ...optionalIdPayload(artifact.id),
      contextKey: nullable(artifact.contextKey),
      ...evidencePayload(artifact),
      signatureDocumentId: nullable(artifact.signatureDocumentId),
      signatureDocumentVersionId: nullable(artifact.signatureDocumentVersionId),
      signedAt: nullable(artifact.signedAt),
      entries: artifact.entries.map((entry, index) => {
        const work = workByKey.get(entry.workExperienceKey);
        const workExperienceId = work ? optionalId(work.id) : undefined;
        return {
          ...optionalIdPayload(entry.id),
          ...(workExperienceId
            ? { workExperienceId }
            : entry.workExperienceKey
              ? { workExperienceSequenceNo: workSequenceByKey.get(entry.workExperienceKey) }
              : {}),
          sequenceNo: index + 1,
          durationText: nullable(entry.durationText),
          position: entry.position.trim(),
          officeUnit: entry.officeUnit.trim(),
          immediateSupervisor: entry.immediateSupervisor.trim(),
          agencyOrganizationLocation: entry.agencyOrganizationLocation.trim(),
          accomplishments: nullable(entry.accomplishments),
          actualDuties: entry.actualDuties.trim(),
        };
      }),
    })),
  };
  return {
    ...payload,
    education: educationPayload(form.education),
    eligibility: eligibilityPayload(form.eligibility),
    otherInformation: {
      skillsAndHobbies: nullable(form.otherInformation.specialSkillsHobbies),
      nonAcademicDistinctions: nullable(form.otherInformation.nonAcademicDistinctions),
      associationMemberships: nullable(form.otherInformation.memberships),
    },
    declarations: {
      ...Object.fromEntries(
        Object.entries(declarationAnswerKeys).map(([uiKey, apiKey]) => [
          apiKey,
          booleanPayload(form.declarations[uiKey as keyof typeof declarationAnswerKeys]),
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(declarationDetailKeys).map(([uiKey, apiKey]) => [
          apiKey,
          nullable(form.declarations[uiKey as keyof typeof declarationDetailKeys]),
        ]),
      ),
      criminalChargeDateFiled: nullable(form.declarations.criminalChargeDateFiled),
      criminalChargeDateFiledUnknown: booleanPayload(
        form.declarations.criminalChargeDateFiledUnknown,
      ),
      criminalChargeStatus: nullable(form.declarations.criminalChargeStatus),
      separationMode: nullable(form.declarations.separationMode),
      immigrantCountry: nullable(form.declarations.immigrantCountry),
      disabilityIdNumber: nullable(form.declarations.disabilityIdNumber),
      soloParentIdNumber: nullable(form.declarations.soloParentIdNumber),
    },
    references: form.references.map((record, index) => ({
      ...optionalIdPayload(record.id),
      sequenceNo: index + 1,
      name: nullable(record.name),
      address: nullable(record.address),
      contact: nullable(record.telephoneNumber),
    })),
    certification: {
      truthDeclarationAccepted: form.certification.truthDeclarationAccepted,
      verificationAuthorizationAccepted: form.certification.verificationAuthorizationAccepted,
      misrepresentationWarningAccepted: form.certification.misrepresentationWarningAccepted,
      governmentIdType: nullable(form.certification.governmentIdType),
      governmentIdNumber: nullable(form.certification.governmentIdNumber),
      governmentIdIssuedAt: nullable(form.certification.governmentIdIssuedDate),
      governmentIdIssuedPlace: nullable(form.certification.governmentIdIssuedPlace),
      photoDocumentId: nullable(form.certification.photoDocumentId),
      photoDocumentVersionId: nullable(form.certification.photoDocumentVersionId),
      employeeSignatureDocumentId: nullable(form.certification.signatureDocumentId),
      employeeSignatureDocumentVersionId: nullable(form.certification.signatureDocumentVersionId),
      employeeSignatureDate: nullable(form.certification.employeeSignatureDate),
      thumbmarkDocumentId: nullable(form.certification.thumbmarkDocumentId),
      thumbmarkDocumentVersionId: nullable(form.certification.thumbmarkDocumentVersionId),
      subscribedAndSwornText: nullable(form.certification.subscribedAndSwornText),
      subscribedAndSwornAt: dateTimePayload(form.certification.oathDate),
      oathAdministeredBy: nullable(form.certification.oathAdministeredBy),
      oathAdminSignatureDocumentId: nullable(form.certification.oathAdminSignatureDocumentId),
      oathAdminSignatureDocumentVersionId: nullable(
        form.certification.oathAdminSignatureDocumentVersionId,
      ),
      oathAdministeredAt: dateTimePayload(form.certification.oathAdministeredAt),
    },
    pageSignatures: form.certification.pageSignatures.map((signature) => ({
      pageKey: pdsPageKeys[signature.pageNo - 1],
      signatureDocumentId: nullable(signature.signatureDocumentId),
      signatureDocumentVersionId: nullable(signature.signatureDocumentVersionId),
      signedAt: dateTimePayload(signature.signedAt),
      signatureDate: nullable(signature.signedAt),
    })),
  };
}

function formDetailSections(form: PdsForm): PdsDetailSections {
  const workSequenceByKey = new Map(
    form.workExperience.map((row, index) => [row.uiKey, index + 1]),
  );
  const workByKey = new Map(form.workExperience.map((row) => [row.uiKey, row]));

  return {
    workExperience: form.workExperience.map((row, index) => ({
      ...optionalIdPayload(row.id),
      sequenceNo: index + 1,
      inclusiveFrom: nullable(row.inclusiveFrom),
      inclusiveTo: nullable(row.inclusiveTo),
      positionTitle: nullable(row.positionTitle),
      departmentAgencyOfficeCompany: nullable(row.departmentAgencyOfficeCompany),
      monthlySalary: numberValue(row.monthlySalary),
      salaryGradeStep: nullable(row.salaryGradeStep),
      appointmentStatus: nullable(row.appointmentStatus),
      governmentService:
        row.governmentService === 'Y' || row.governmentService === 'N'
          ? row.governmentService
          : null,
      isCurrent: row.isCurrent,
      ...evidencePayload(row),
    })),
    voluntaryWork: form.voluntaryWork.map((row, index) => ({
      ...optionalIdPayload(row.id),
      sequenceNo: index + 1,
      organizationNameAddress: nullable(row.organizationNameAddress),
      inclusiveFrom: nullable(row.inclusiveFrom),
      inclusiveTo: nullable(row.inclusiveTo),
      hours: numberValue(row.hours),
      positionNatureOfWork: nullable(row.positionNatureOfWork),
      ...evidencePayload(row),
    })),
    learningAndDevelopment: form.learningAndDevelopment.map((row, index) => ({
      ...optionalIdPayload(row.id),
      sequenceNo: index + 1,
      interventionTitle: nullable(row.interventionTitle),
      attendanceFrom: nullable(row.attendanceFrom),
      attendanceTo: nullable(row.attendanceTo),
      hours: numberValue(row.hours),
      type: nullable(row.type),
      conductedSponsoredBy: nullable(row.conductedSponsoredBy),
      ...evidencePayload(row),
    })),
    wes: form.wes.map((artifact) => ({
      ...optionalIdPayload(artifact.id),
      contextKey: nullable(artifact.contextKey),
      ...evidencePayload(artifact),
      signatureDocumentId: nullable(artifact.signatureDocumentId),
      signatureDocumentVersionId: nullable(artifact.signatureDocumentVersionId),
      signedAt: nullable(artifact.signedAt),
      entries: artifact.entries.map((entry, index) => {
        const work = workByKey.get(entry.workExperienceKey);
        const workExperienceId = work ? optionalId(work.id) : undefined;
        const workExperienceSequenceNo = workSequenceByKey.get(entry.workExperienceKey);
        return {
          ...optionalIdPayload(entry.id),
          ...(workExperienceId
            ? { workExperienceId }
            : workExperienceSequenceNo
              ? { workExperienceSequenceNo }
              : {}),
          sequenceNo: index + 1,
          durationText: entry.durationText,
          position: nullable(entry.position),
          officeUnit: nullable(entry.officeUnit),
          immediateSupervisor: nullable(entry.immediateSupervisor),
          agencyOrganizationLocation: nullable(entry.agencyOrganizationLocation),
          accomplishments: nullable(entry.accomplishments),
          actualDuties: nullable(entry.actualDuties),
        };
      }),
    })),
  };
}

export function detailAfterSave(saved: PdsDetailData, form: PdsForm): PdsDetailData {
  const fallback = formDetailSections(form);
  return {
    ...saved,
    workExperience: saved.workExperience ?? fallback.workExperience,
    voluntaryWork: saved.voluntaryWork ?? fallback.voluntaryWork,
    learningAndDevelopment: saved.learningAndDevelopment ?? fallback.learningAndDevelopment,
    wes: saved.wes ?? fallback.wes,
  };
}

function summaryFromDetail(detail: PdsDetailData): PdsVersionSummaryData {
  return {
    id: detail.id,
    employeeId: detail.employeeId,
    versionNo: detail.versionNo,
    formVersion: detail.formVersion,
    asOfDate: detail.asOfDate,
    status: detail.status,
    supersedesVersionId: detail.supersedesVersionId,
    correctionReason: detail.correctionReason,
    createdByMembershipId: detail.createdByMembershipId,
    createdAt: detail.createdAt,
    updatedByMembershipId: detail.updatedByMembershipId,
    updatedAt: detail.updatedAt,
    rowVersion: detail.rowVersion,
    fieldScope: detail.fieldScope,
  };
}

export function listAfterSave(list: PdsVersionListData, detail: PdsDetailData): PdsVersionListData {
  const next = summaryFromDetail(detail);
  const versions = [next, ...list.versions.filter((version) => version.id !== next.id)].sort(
    (left, right) => right.versionNo - left.versionNo,
  );
  return {
    employeeId: detail.employeeId,
    citizenshipCountries: list.citizenshipCountries,
    current:
      versions.find((version) => version.status === 'CERTIFIED') ??
      versions.find((version) => version.status !== 'SUPERSEDED') ??
      versions[0] ??
      null,
    draft: versions.find((version) => ['DRAFT', 'RETURNED'].includes(version.status)) ?? null,
    versions,
  };
}
