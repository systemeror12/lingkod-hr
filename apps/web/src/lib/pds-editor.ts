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
  umidIdNumber: string | null;
  pagibigIdNumber: string | null;
  philhealthNumber: string | null;
  philSysCardNumber: string | null;
  tinNumber: string | null;
  agencyEmployeeNumber: string | null;
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
  entries: PdsWesEntryData[];
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
  entries: WesEntryForm[];
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
  umidIdNumber: string;
  pagibigIdNumber: string;
  philhealthNumber: string;
  philSysCardNumber: string;
  tinNumber: string;
  agencyEmployeeNumber: string;
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
}

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
    umidIdNumber: '',
    pagibigIdNumber: '',
    philhealthNumber: '',
    philSysCardNumber: '',
    tinNumber: '',
    agencyEmployeeNumber: '',
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
    entries: [blankWesEntry()],
    ...blankEvidence(),
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
      umidIdNumber: stringValue(personal?.umidIdNumber),
      pagibigIdNumber: stringValue(personal?.pagibigIdNumber),
      philhealthNumber: stringValue(personal?.philhealthNumber),
      philSysCardNumber: stringValue(personal?.philSysCardNumber),
      tinNumber: stringValue(personal?.tinNumber),
      agencyEmployeeNumber: stringValue(personal?.agencyEmployeeNumber),
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
      umidIdNumber: nullable(personal.umidIdNumber),
      pagibigIdNumber: nullable(personal.pagibigIdNumber),
      philhealthNumber: nullable(personal.philhealthNumber),
      philSysCardNumber: nullable(personal.philSysCardNumber),
      tinNumber: nullable(personal.tinNumber),
      agencyEmployeeNumber: nullable(personal.agencyEmployeeNumber),
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
