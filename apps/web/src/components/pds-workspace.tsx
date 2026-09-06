'use client';

import { useRecordNavigation } from './record-navigation';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import {
  EmployeeInitials,
  EmployeePageTitle,
  employeeInputClass,
  employeeLabelClass,
  formatEmployeeDate,
  titleCase,
} from './employee-directory';

import {
  blankChild,
  blankEducation,
  blankEligibility,
  blankLearningDevelopment,
  blankPageSignature,
  blankReference,
  blankVoluntaryWork,
  blankWes,
  blankWesEntry,
  blankWorkExperience,
  detailAfterSave,
  declarationFields,
  formFromDetail,
  formPayload,
  listAfterSave,
  moveAt,
  nullable,
  parsePdsEvidenceOptions,
  pageKeysForForm,
  pdsPageKeys,
  removeAt,
  stringValue,
  updateAt,
  yesNoOptions,
  type AddressForm,
  type DeclarationKey,
  type EducationForm,
  type EligibilityForm,
  type EvidenceForm,
  type NameForm,
  type PdsDetailData,
  type PdsEvidenceOption,
  type PdsVersionListData,
  type PersonalForm,
  type SpouseForm,
  type WorkExperienceForm,
} from '../lib/pds-editor';

export type { PdsDetailData, PdsVersionListData } from '../lib/pds-editor';

interface ErrorEnvelope {
  error?: { message?: string; fields?: Record<string, string> };
}

const pdsCertificationStatements = {
  truthDeclaration:
    'I declare under oath that I have personally accomplished this Personal Data Sheet which is a true, correct, and complete statement pursuant to the provisions of pertinent laws, rules, and regulations of the Republic of the Philippines.',
  verificationAuthorization:
    'I authorize the agency head/authorized representative to verify/validate the contents stated herein.',
  misrepresentationWarning:
    'I agree that any misrepresentation made in this document and its attachments shall cause the filing of administrative/criminal case/s against me.',
} as const;

function responseError(value: unknown, fallback: string): string {
  return ((value ?? {}) as ErrorEnvelope).error?.message ?? fallback;
}

function responseField(value: unknown): string | null {
  const fields = ((value ?? {}) as ErrorEnvelope).error?.fields;
  return fields ? (Object.keys(fields)[0] ?? null) : null;
}

const deficiencyLabels: Record<string, string> = {
  'personal.surname': 'Surname',
  'personal.firstName': 'First name',
  'personal.birthDate': 'Birth date',
  'personal.birthPlace': 'Place of birth',
  'personal.sex': 'Sex at birth',
  'personal.civilStatus': 'Civil status',
  'personal.heightMeters': 'Height (metres)',
  'personal.weightKilograms': 'Weight (kilograms)',
  'personal.bloodType': 'Blood type',
  'personal.citizenship': 'Citizenship',
  'personal.dualCitizenshipType': 'Dual citizenship basis',
  'personal.dualCitizenshipCountry': 'Other citizenship country',
  'otherInformation.skillsAndHobbies': 'Special skills and hobbies',
  'otherInformation.nonAcademicDistinctions': 'Non-academic distinctions',
  'otherInformation.associationMemberships': 'Membership in associations',
  'declarations.relationshipDetails': '34.a Related within the third degree? details',
  'declarations.relatedWithinFourthDegreeDetails': '34.b Related within the fourth degree? details',
  'declarations.administrativeOffenseDetails':
    '35.a Found guilty of an administrative offense? details',
  'declarations.criminalChargeDetails': '35.b Criminally charged before any court? details',
  'declarations.criminalChargeDateFiled': 'Date filed',
  'declarations.criminalChargeStatus': 'Case status',
  'declarations.convictionDetails': '36 Convicted of any crime? details',
  'declarations.separationMode': 'Separation mode',
  'declarations.separationDetails': '37 Separated from service? details',
  'declarations.candidacyDetails': '38.a Candidate in an election? details',
  'declarations.resignationDetails': '38.b Resigned for an election campaign? details',
  'declarations.immigrantCountry': 'Country of immigration or permanent residence',
  'declarations.indigenousGroupDetails': '40.a Indigenous group member? details',
  'declarations.disabilitySpecification': '40.b Person with disability? details',
  'declarations.disabilityIdNumber': 'Disability ID number',
  'declarations.soloParentSpecification': '40.c Solo parent? details',
  'declarations.soloParentIdNumber': 'Solo parent ID number',
  'certification.truthDeclarationAccepted': 'Truth declaration accepted',
  'certification.verificationAuthorizationAccepted': 'Verification authorization accepted',
  'certification.misrepresentationWarningAccepted': 'Misrepresentation warning accepted',
  'certification.photoDocumentId': 'Photo document ID',
  'certification.governmentIdType': 'Government ID type',
  'certification.governmentIdNumber': 'Government ID number',
  'certification.governmentIdIssuedAt': 'Government ID issued date',
  'certification.governmentIdIssuedPlace': 'Government ID issued place',
  'certification.employeeSignatureDocumentId': 'Signature document ID',
  'certification.employeeSignatureDate': 'Employee signature date',
  'certification.subscribedAndSwornText': 'Subscribed and sworn text',
  'certification.subscribedAndSwornAt': 'Subscribed and sworn date',
  'certification.oathAdministeredBy': 'Administering officer',
  'certification.oathAdminSignatureDocumentId': 'Oath administrator signature document ID',
  'certification.oathAdministeredAt': 'Oath administration date',
  'wes.signatureDocumentId': 'WES signature document ID',
  'wes.signedAt': 'WES signed date',
};

const declarationApiFields: Record<DeclarationKey, string> = {
  relatedThirdDegree: 'relatedWithinThirdDegree',
  relatedThirdDegreeDetails: 'relationshipDetails',
  relatedFourthDegree: 'relatedWithinFourthDegreeLgu',
  relatedFourthDegreeDetails: 'relatedWithinFourthDegreeDetails',
  administrativeCase: 'foundGuiltyAdministrativeOffense',
  administrativeCaseDetails: 'administrativeOffenseDetails',
  criminalCharge: 'criminallyCharged',
  criminalChargeDetails: 'criminalChargeDetails',
  criminalChargeDateFiled: 'criminalChargeDateFiled',
  criminalChargeDateFiledUnknown: 'criminalChargeDateFiledUnknown',
  criminalChargeStatus: 'criminalChargeStatus',
  conviction: 'convictedOfCrime',
  convictionDetails: 'convictionDetails',
  separatedFromService: 'separatedFromService',
  separationMode: 'separationMode',
  separatedFromServiceDetails: 'separationDetails',
  electionCandidate: 'candidateInLastElection',
  electionCandidateDetails: 'candidacyDetails',
  resignedForElection: 'resignedBeforeElection',
  resignedForElectionDetails: 'resignationDetails',
  immigrant: 'immigrantOrPermanentResident',
  immigrantCountry: 'immigrantCountry',
  immigrantDetails: 'immigrantDetails',
  indigenousGroup: 'indigenousGroupMember',
  indigenousGroupDetails: 'indigenousGroupDetails',
  disability: 'personWithDisability',
  disabilityIdNumber: 'disabilityIdNumber',
  disabilityDetails: 'disabilitySpecification',
  soloParent: 'soloParent',
  soloParentDetails: 'soloParentSpecification',
  soloParentIdNumber: 'soloParentIdNumber',
};

function deficiencyLabel(field: string): string | null {
  const reference = /^references\.(\d+)\.(name|address|contact)$/.exec(field);
  if (reference) {
    return {
      name: 'Reference name',
      address: 'Reference address',
      contact: 'Reference telephone',
    }[reference[2] as 'name' | 'address' | 'contact'];
  }
  const page = /^pageSignatures\.(C\d+)\.(signatureDocumentId|signedAt|signatureDate)$/.exec(field);
  if (page) {
    const pageNo = pdsPageKeys.indexOf(page[1] as (typeof pdsPageKeys)[number]) + 1;
    if (pageNo > 0) {
      return page[2] === 'signatureDocumentId'
        ? `Page ${pageNo} signature document ID`
        : `Page ${pageNo} signed date`;
    }
  }
  return deficiencyLabels[field] ?? null;
}

function focusDeficiency(field: string): void {
  type FocusableControl = {
    labels?: ArrayLike<{ textContent?: string | null }> | null;
    getAttribute(name: string): string | null;
    focus(): void;
    scrollIntoView(options: { block: string }): void;
  };
  const browser = globalThis as unknown as {
    document: { querySelectorAll(selector: string): ArrayLike<FocusableControl> };
  };
  const marked = Array.from(browser.document.querySelectorAll('.record-form [data-pds-field]'));
  const exact = marked.find((element) => element.getAttribute('data-pds-field') === field);
  if (exact) {
    exact.focus();
    exact.scrollIntoView({ block: 'center' });
    return;
  }
  const label = deficiencyLabel(field);
  if (!label) return;
  const controls = Array.from(
    browser.document.querySelectorAll(
      '.record-form input, .record-form select, .record-form textarea',
    ),
  );
  const control = controls.find((element) =>
    Array.from(element.labels ?? []).some((item) => item.textContent?.trim() === label),
  );
  control?.focus();
  control?.scrollIntoView({ block: 'center' });
}

type WorkflowAction = 'submit' | 'return' | 'certify' | 'verify' | 'correct' | 'outputs';

const workflowCopy: Record<WorkflowAction, { title: string; description: string; submit: string }> =
  {
    submit: {
      title: 'Submit PDS',
      description: 'Send this complete Draft or Returned PDS for certification and HR review.',
      submit: 'Submit',
    },
    return: {
      title: 'Return PDS',
      description: 'Return this submitted PDS with a reason the employee can act on.',
      submit: 'Return with reason',
    },
    certify: {
      title: 'Employee certify PDS',
      description: 'Record the employee certification for this submitted PDS.',
      submit: 'Employee certify',
    },
    verify: {
      title: 'HR verify PDS',
      description:
        'Verify this submitted PDS after employee certification without changing declared content.',
      submit: 'HR verify',
    },
    correct: {
      title: 'Correct certified PDS',
      description: 'Create a reasoned successor Draft linked to this certified PDS.',
      submit: 'Correct certified',
    },
    outputs: {
      title: 'Generate output',
      description: 'Generate released PDS and WES output artifacts from this exact version.',
      submit: 'Generate output',
    },
  };

const workflowMessages: Record<WorkflowAction, string> = {
  submit: 'PDS submitted.',
  return: 'PDS returned.',
  certify: 'PDS employee certification recorded.',
  verify: 'PDS HR verification recorded.',
  correct: 'Correction Draft created.',
  outputs: 'PDS output generation started.',
};

const addressFields = [
  ['houseBlockLotNo', 'House / block / lot no.'],
  ['street', 'Street'],
  ['subdivisionVillage', 'Subdivision / village'],
  ['barangay', 'Barangay'],
  ['cityMunicipality', 'City / municipality'],
  ['province', 'Province'],
  ['zipCode', 'ZIP code'],
] as const satisfies readonly [keyof AddressForm, string][];

const nameFields = [
  ['surname', 'Surname'],
  ['firstName', 'First name'],
  ['middleName', 'Middle name'],
  ['nameExtension', 'Name extension'],
] as const satisfies readonly [keyof NameForm, string][];

const personalTextFields = [
  ['surname', 'Surname'],
  ['firstName', 'First name'],
  ['middleName', 'Middle name'],
  ['nameExtension', 'Name extension'],
  ['birthPlace', 'Place of birth'],
  ['bloodType', 'Blood type'],
  ['telephoneNumber', 'Telephone'],
  ['mobileNumber', 'Mobile'],
  ['emailAddress', 'Email address'],
] as const satisfies readonly [keyof PersonalForm, string][];

const workExperienceOptions = [
  ['Y', 'Yes'],
  ['N', 'No'],
] as const satisfies readonly (readonly [string, string])[];

const educationLevelOptions = [
  ['ELEMENTARY', 'Elementary'],
  ['SECONDARY', 'Secondary'],
  ['VOCATIONAL_TRADE', 'Vocational / trade course'],
  ['COLLEGE', 'College'],
  ['GRADUATE_STUDIES', 'Graduate studies'],
] as const;

const eligibilityCategoryOptions = [
  'Career Service',
  'RA 1080 (Board/Bar)',
  'Under Special Laws',
  'CES/CSEE',
  'Barangay Eligibility',
  "Driver's License",
] as const;

function sequenceLabel(from: string, to: string, isCurrent = false): string {
  if (isCurrent) {
    if (from) return `${formatEmployeeDate(from)} to Present`;
    return 'Present';
  }
  if (from && to) return `${formatEmployeeDate(from)} to ${formatEmployeeDate(to)}`;
  if (from) return formatEmployeeDate(from);
  if (to) return formatEmployeeDate(to);
  return 'Not provided';
}

function workExperienceLabel(row: WorkExperienceForm, index: number): string {
  const position = nullable(row.positionTitle);
  const office = nullable(row.departmentAgencyOfficeCompany);
  const duration =
    row.inclusiveFrom || row.inclusiveTo || row.isCurrent
      ? sequenceLabel(row.inclusiveFrom, row.inclusiveTo, row.isCurrent)
      : null;
  return [position, office, duration].filter(Boolean).join(' · ') || `Work experience ${index + 1}`;
}

function display(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'Not provided' : String(value);
}

function TextField({
  label,
  field,
  value,
  onChange,
  type = 'text',
  required = false,
  min,
  step,
  list,
  disabled = false,
}: {
  label: string;
  field?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date' | 'email' | 'number';
  required?: boolean;
  min?: string;
  step?: string;
  list?: string;
  disabled?: boolean;
}) {
  return (
    <label className={employeeLabelClass}>
      {label}
      <input
        data-pds-field={field}
        className={employeeInputClass}
        type={type}
        value={value}
        onChange={(event) => onChange((event.target as unknown as { value: string }).value)}
        required={required}
        min={min}
        step={step}
        list={list}
        disabled={disabled}
      />
    </label>
  );
}

function TextAreaField({
  label,
  field,
  value,
  onChange,
  required = false,
}: {
  label: string;
  field?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className={employeeLabelClass}>
      {label}
      <textarea
        data-pds-field={field}
        className={`${employeeInputClass} min-h-[96px] resize-y`}
        value={value}
        onChange={(event) => onChange((event.target as unknown as { value: string }).value)}
        required={required}
      />
    </label>
  );
}

function SelectField({
  label,
  field,
  value,
  onChange,
  options,
  required = false,
  placeholder = 'Not provided',
  disabled = false,
}: {
  label: string;
  field?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className={employeeLabelClass}>
      {label}
      <select
        data-pds-field={field}
        className={employeeInputClass}
        value={value}
        onChange={(event) => onChange((event.target as unknown as { value: string }).value)}
        required={required}
        disabled={disabled}
      >
        <option value="">{placeholder}</option>
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleField({
  label,
  field,
  checked,
  onChange,
}: {
  label: string;
  field?: string | undefined;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm font-[560] text-ink">
      <input
        data-pds-field={field}
        className="size-4 rounded border border-line"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange((event.target as unknown as { checked: boolean }).checked)}
      />
      {label}
    </label>
  );
}

function AddressFields({
  value,
  onChange,
  fieldPrefix,
}: {
  value: AddressForm;
  onChange: (key: keyof AddressForm, value: string) => void;
  fieldPrefix?: string;
}) {
  return (
    <div className="grid gap-4 min-[620px]:grid-cols-2">
      {addressFields.map(([key, label]) => (
        <TextField
          key={key}
          label={label}
          field={fieldPrefix ? `${fieldPrefix}.${key}` : undefined}
          value={value[key]}
          onChange={(next) => onChange(key, next)}
        />
      ))}
    </div>
  );
}

function NameFields({
  value,
  onChange,
  fieldPrefix,
  includeNameExtension = true,
}: {
  value: NameForm;
  onChange: (key: keyof NameForm, value: string) => void;
  fieldPrefix?: string;
  includeNameExtension?: boolean;
}) {
  const fields = includeNameExtension
    ? nameFields
    : nameFields.filter(([key]) => key !== 'nameExtension');
  return (
    <div className="grid gap-4 min-[620px]:grid-cols-2">
      {fields.map(([key, label]) => (
        <TextField
          key={key}
          label={label}
          field={fieldPrefix ? `${fieldPrefix}.${key}` : undefined}
          value={value[key]}
          onChange={(next) => onChange(key, next)}
        />
      ))}
    </div>
  );
}

function EvidenceFields({
  value,
  onChange,
  options,
  loading,
  canBrowse,
}: {
  value: EvidenceForm;
  onChange: (key: keyof EvidenceForm, value: string) => void;
  options: readonly PdsEvidenceOption[];
  loading: boolean;
  canBrowse: boolean;
}) {
  const selectedKey =
    value.documentId && value.documentVersionId
      ? `${value.documentId}:${value.documentVersionId}`
      : '';
  const choices: readonly (readonly [string, string])[] = [
    ...(selectedKey &&
    !options.some((option) => `${option.documentId}:${option.version.id}` === selectedKey)
      ? [[selectedKey, 'Current linked Document Version'] as const]
      : []),
    ...options.map(
      (option) =>
        [
          `${option.documentId}:${option.version.id}`,
          `${option.documentNo ?? titleCase(option.documentType)} · v${option.version.versionNo}`,
        ] as const,
    ),
  ];

  return (
    <div className="grid gap-2">
      <SelectField
        label="Controlled evidence Document Version"
        value={selectedKey}
        options={choices}
        placeholder={
          loading
            ? 'Loading finalized Agency Document Versions…'
            : canBrowse
              ? 'No finalized Agency Document Version selected'
              : 'Evidence selection is restricted for this membership'
        }
        disabled={loading || !canBrowse}
        onChange={(next) => {
          const [documentId = '', documentVersionId = ''] = next.split(':');
          onChange('documentId', documentId);
          onChange('documentVersionId', documentVersionId);
        }}
      />
      <p className="m-0 text-xs leading-5 text-muted">
        Select one finalized same-Agency Document Version. Source storage is shared and is not
        copied into the PDS.
      </p>
    </div>
  );
}

function FormSection({
  item,
  title,
  children,
}: {
  item: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="m-0 grid gap-4 border-0 border-t border-line p-0 pt-5 first:border-t-0 first:pt-0">
      <legend className="m-0 flex items-baseline gap-3 p-0">
        <span className="font-mono text-[10px] font-bold tracking-[.1em] text-cobalt">{item}</span>
        <span className="text-sm font-[680] text-midnight">{title}</span>
      </legend>
      {children}
    </fieldset>
  );
}

function RepeatableRow({
  title,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onRemove,
  children,
}: {
  title: string;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const label = `${title} ${index + 1}`;
  const labelId = useId();
  return (
    <fieldset
      aria-labelledby={labelId}
      className="grid gap-4 rounded-[3px] border border-line bg-[#fafbfd] p-4"
    >
      <legend id={labelId} className="sr-only">
        {label}
      </legend>
      <div className="flex flex-col gap-3 min-[620px]:flex-row min-[620px]:items-center min-[620px]:justify-between">
        <strong aria-hidden="true" className="text-xs font-[680] text-ink">
          {label}
        </strong>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="default"
            disabled={index === 0}
            aria-label={`Move ${label.toLowerCase()} up`}
            onClick={onMoveUp}
          >
            Move up
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="default"
            disabled={index === total - 1}
            aria-label={`Move ${label.toLowerCase()} down`}
            onClick={onMoveDown}
          >
            Move down
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="default"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      </div>
      {children}
    </fieldset>
  );
}

function EmptyRows({ message }: { message: string }) {
  return <p className="m-0 text-sm leading-6 text-muted">{message}</p>;
}

function DetailValue({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <dt className="text-[10px] font-bold tracking-[.08em] text-muted uppercase">{label}</dt>
      <dd className="mt-1 break-words text-sm font-[560] text-ink">{display(value)}</dd>
    </div>
  );
}

function RowButtons({
  label,
  index,
  count,
  onMove,
  onRemove,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="secondary"
        size="default"
        onClick={() => onMove(-1)}
        disabled={index === 0}
      >
        Move {label} up
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="default"
        onClick={() => onMove(1)}
        disabled={index === count - 1}
      >
        Move {label} down
      </Button>
      <Button type="button" variant="secondary" size="default" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors =
    status === 'DRAFT' || status === 'RETURNED'
      ? 'bg-[#fff2d9] text-[#82520d]'
      : status === 'CERTIFIED'
        ? 'bg-[#e7f4eb] text-[#27633b]'
        : 'bg-pale-blue text-cobalt';
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[.06em] ${colors}`}
    >
      {status}
    </span>
  );
}

function WorkflowDialog({
  action,
  busy,
  error,
  reason,
  onReasonChange,
  onClose,
  onSubmit,
}: {
  action: WorkflowAction | null;
  busy: boolean;
  error: string | null;
  reason: string;
  onReasonChange: (value: string) => void;
  onClose: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) (errorRef.current as { focus: () => void } | null)?.focus();
  }, [error]);

  if (!action) return null;
  const copy = workflowCopy[action];
  const needsReason = action === 'return' || action === 'correct';

  return (
    <Dialog open onOpenChange={(next) => !busy && onClose(next)}>
      <DialogContent size="compact" aria-describedby="pds-workflow-description">
        <DialogHeader>
          <div className="grid gap-1.5">
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription id="pds-workflow-description">{copy.description}</DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody>
          <form id="pds-workflow-form" className="grid gap-4" onSubmit={onSubmit}>
            {error && (
              <div
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                className="rounded-[3px] border-l-2 border-[#b64040] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d] outline-none"
              >
                {error}
              </div>
            )}
            {needsReason ? (
              <TextAreaField
                label={action === 'return' ? 'Return reason' : 'Correction reason'}
                value={reason}
                onChange={onReasonChange}
                required
              />
            ) : (
              <p className="m-0 text-sm leading-6 text-muted">
                This action uses the current version exactly as shown.
              </p>
            )}
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary" size="default" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="pds-workflow-form"
            variant="primary"
            size="default"
            disabled={busy}
          >
            {busy ? `${copy.submit}...` : copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PdsWorkspace({
  agencyId,
  employeeName,
  initialList,
  initialDetail,
  canUpdate,
  canSubmit = false,
  canReturn = false,
  canCertify = false,
  canVerify = false,
  canCorrect = false,
  canGenerateOutputs = false,
  canBrowseEvidence,
  createUrl,
  backHref,
}: {
  agencyId: string;
  employeeName?: string;
  initialList: PdsVersionListData;
  initialDetail: PdsDetailData | null;
  canUpdate: boolean;
  canSubmit?: boolean;
  canReturn?: boolean;
  canCertify?: boolean;
  canVerify?: boolean;
  canCorrect?: boolean;
  canGenerateOutputs?: boolean;
  canBrowseEvidence: boolean;
  createUrl: string;
  backHref: string;
}) {
  const [list, setList] = useState(initialList);
  const [detail, setDetail] = useState(initialDetail);
  const [form, setForm] = useState(() => formFromDetail(initialDetail));
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [workflowAction, setWorkflowAction] = useState<WorkflowAction | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowReason, setWorkflowReason] = useState('');
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok');
  const [error, setError] = useState<string | null>(null);
  const [deficiencyField, setDeficiencyField] = useState<string | null>(null);
  const [evidenceOptions, setEvidenceOptions] = useState<PdsEvidenceOption[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const workflowReturnFocusRef = useRef<{ focus(): void } | null>(null);
  const navigation = useRecordNavigation();
  const versionId = navigation.search.get('pdsVersion');
  const [versionError, setVersionError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setVersionError(null);
    setOpen(false);
    if (!versionId) {
      setDetail(initialDetail);
      setForm(formFromDetail(initialDetail));
      return;
    }
    setDetail(null);
    if (!list.versions.some((version) => version.id === versionId)) {
      setVersionError('This PDS version is missing or outside this Employee record.');
      return;
    }
    void fetch(`/api/v1/agencies/${agencyId}/pds/${encodeURIComponent(versionId)}`, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('This PDS version is unavailable in your permitted scope.');
        const next = (await response.json()) as PdsDetailData;
        if (active) {
          setDetail(next);
          setForm(formFromDetail(next));
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setVersionError(
            cause instanceof Error ? cause.message : 'The PDS version could not be loaded.',
          );
      });
    return () => {
      active = false;
    };
  }, [versionId]);
  const pageSignatureShape = pageKeysForForm(form).join('|');
  const editable = detail?.fieldScope === 'FULL' && ['DRAFT', 'RETURNED'].includes(detail.status);
  const canCreate =
    canUpdate &&
    (!versionId || Boolean(detail)) &&
    (!detail || (detail.fieldScope === 'FULL' && !list.draft));
  const submittedWorkflowActions = [
    canReturn ? 'return' : null,
    canCertify ? 'certify' : null,
    canVerify ? 'verify' : null,
  ].filter((action): action is WorkflowAction => action !== null);
  const certifiedWorkflowActions = [
    canCorrect ? 'correct' : null,
    canGenerateOutputs ? 'outputs' : null,
  ].filter((action): action is WorkflowAction => action !== null);
  const workflowActions: WorkflowAction[] = !detail
    ? []
    : detail.status === 'DRAFT' || detail.status === 'RETURNED'
      ? canSubmit
        ? ['submit']
        : []
      : detail.status === 'SUBMITTED'
        ? submittedWorkflowActions
        : detail.status === 'CERTIFIED'
          ? certifiedWorkflowActions
          : [];
  const personal = detail?.personal;
  const family = detail?.family;
  const detailWorkExperience = detail?.workExperience ?? [];
  const detailVoluntaryWork = detail?.voluntaryWork ?? [];
  const detailLearningAndDevelopment = detail?.learningAndDevelopment ?? [];
  const detailWes = detail?.wes ?? [];
  const workOptions = form.workExperience.map(
    (row, index) => [row.uiKey, workExperienceLabel(row, index)] as const,
  );

  useEffect(() => {
    setForm((current) => {
      const pageKeys = pageKeysForForm(current);
      const currentPageKeys = current.certification.pageSignatures.map(
        (signature) => pdsPageKeys[signature.pageNo - 1],
      );
      if (
        currentPageKeys.length === pageKeys.length &&
        currentPageKeys.every((pageKey, index) => pageKey === pageKeys[index])
      ) {
        return current;
      }
      const signaturesByPage = new Map(
        current.certification.pageSignatures.map((signature) => [
          pdsPageKeys[signature.pageNo - 1],
          signature,
        ]),
      );
      return {
        ...current,
        certification: {
          ...current.certification,
          pageSignatures: pageKeys.map(
            (pageKey) => signaturesByPage.get(pageKey) ?? blankPageSignature(pageKey),
          ),
        },
      };
    });
  }, [pageSignatureShape]);

  useEffect(() => {
    if (error) (errorRef.current as { focus: () => void } | null)?.focus();
  }, [error]);

  useEffect(() => {
    if (!open || !canBrowseEvidence) return;
    let active = true;
    setEvidenceLoading(true);
    void fetch(`/api/v1/agencies/${agencyId}/documents/versions`, { credentials: 'include' })
      .then(async (response) => {
        const value: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error('Agency Document Versions could not be loaded.');
        if (active) setEvidenceOptions(parsePdsEvidenceOptions(value));
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Agency Document Versions could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) setEvidenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agencyId, canBrowseEvidence, open]);

  function openForm() {
    setForm(formFromDetail(detail));
    setError(null);
    setDeficiencyField(null);
    setOpen(true);
  }

  function openWorkflow(action: WorkflowAction, trigger: { focus(): void }) {
    workflowReturnFocusRef.current = trigger;
    setWorkflowAction(action);
    setWorkflowReason('');
    setWorkflowError(null);
    setMessage(null);
  }

  function closeWorkflow(next: boolean) {
    if (workflowBusy || next) return;
    setWorkflowAction(null);
    setWorkflowError(null);
    const target = workflowReturnFocusRef.current;
    setTimeout(() => target?.focus(), 0);
  }

  function applyWorkflowResult(action: WorkflowAction, value: unknown) {
    if (value && typeof value === 'object' && typeof (value as PdsDetailData).id === 'string') {
      const saved = value as PdsDetailData;
      setDetail(saved);
      setForm(formFromDetail(saved));
      setList((current) => listAfterSave(current, saved));
    }
    setWorkflowAction(null);
    setMessageTone('ok');
    const outputCount =
      action === 'outputs' &&
      value &&
      typeof value === 'object' &&
      Array.isArray((value as { outputs?: unknown }).outputs)
        ? (value as { outputs: unknown[] }).outputs.length
        : null;
    setMessage(
      outputCount === null
        ? workflowMessages[action]
        : `${workflowMessages[action]} ${outputCount} artifact${outputCount === 1 ? '' : 's'} ready.`,
    );
    const target = workflowReturnFocusRef.current;
    setTimeout(() => target?.focus(), 0);
  }

  async function submitWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !workflowAction || workflowBusy) return;
    setWorkflowBusy(true);
    setWorkflowError(null);
    try {
      const actionPath =
        workflowAction === 'certify'
          ? `my-pds/${detail.id}/certify`
          : workflowAction === 'outputs'
            ? `pds/${detail.id}/render`
            : `pds/${detail.id}/${workflowAction}`;
      const body =
        workflowAction === 'return'
          ? { reason: workflowReason }
          : workflowAction === 'correct'
            ? { reason: workflowReason }
            : workflowAction === 'certify'
              ? { employeeCertificationAccepted: true }
              : workflowAction === 'outputs'
                ? {}
                : undefined;
      const response = await fetch(`/api/v1/agencies/${agencyId}/${actionPath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const field = responseField(value);
        if (workflowAction === 'submit' && field) {
          setWorkflowAction(null);
          setForm(formFromDetail(detail));
          setOpen(true);
          setError(responseError(value, 'The PDS action could not be completed.'));
          setDeficiencyField(field);
          return;
        }
        throw new Error(responseError(value, 'The PDS action could not be completed.'));
      }
      applyWorkflowResult(workflowAction, value);
    } catch (caught: unknown) {
      setWorkflowError(
        caught instanceof Error ? caught.message : 'The PDS action could not be completed.',
      );
    } finally {
      setWorkflowBusy(false);
    }
  }

  function changePersonal(key: keyof PersonalForm, value: string) {
    setForm((current) => ({
      ...current,
      personal: {
        ...current.personal,
        [key]: value,
        ...(key === 'civilStatus' && value !== 'OTHER' ? { civilStatusDetail: '' } : {}),
        ...(key === 'citizenship' && value !== 'DUAL_CITIZENSHIP'
          ? { dualCitizenshipType: '', dualCitizenshipCountry: '' }
          : {}),
      },
    }));
  }

  function changeAddress(
    section: 'residentialAddress' | 'permanentAddress',
    key: keyof AddressForm,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      personal: {
        ...current.personal,
        [section]: { ...current.personal[section], [key]: value },
      },
    }));
  }

  function changeSpouse(key: keyof SpouseForm, value: string) {
    setForm((current) => ({ ...current, spouse: { ...current.spouse, [key]: value } }));
  }

  function changeSpouseAddress(key: keyof AddressForm, value: string) {
    setForm((current) => ({
      ...current,
      spouse: {
        ...current.spouse,
        businessAddress: { ...current.spouse.businessAddress, [key]: value },
      },
    }));
  }

  function changeName(section: 'father' | 'mother', key: keyof NameForm, value: string) {
    setForm((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));
  }

  function changeEducation(index: number, key: keyof EducationForm, value: string) {
    setForm((current) => ({
      ...current,
      education: current.education.map((record, recordIndex) =>
        recordIndex === index ? { ...record, [key]: value } : record,
      ),
    }));
  }

  function changeEligibility(index: number, key: keyof EligibilityForm, value: string) {
    setForm((current) => ({
      ...current,
      eligibility: current.eligibility.map((record, recordIndex) =>
        recordIndex === index ? { ...record, [key]: value } : record,
      ),
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  async function save(): Promise<void> {
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const payload = formPayload(form);
      const updating = editable && detail !== null;
      const response = await fetch(
        updating ? `/api/v1/agencies/${agencyId}/pds/${detail.id}` : createUrl,
        {
          method: updating ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(updating ? { ...payload, rowVersion: detail.rowVersion } : payload),
        },
      );
      const value: unknown = await response.json().catch(() => null);
      if (
        response.ok &&
        value &&
        typeof value === 'object' &&
        typeof (value as PdsDetailData).id === 'string'
      ) {
        const saved = detailAfterSave(value as PdsDetailData, form);
        setDetail(saved);
        setForm(formFromDetail(saved));
        setList((current) => listAfterSave(current, saved));
        setOpen(false);
        setMessageTone('ok');
        setMessage(updating ? 'PDS Draft saved.' : 'PDS Draft created.');
        return;
      }
      const envelope = (value ?? {}) as ErrorEnvelope;
      setError(envelope.error?.message ?? 'The PDS Draft could not be saved.');
    } catch {
      setError('The PDS Draft could not be saved. Check the connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const education = detail?.education ?? [];
  const eligibility = detail?.eligibility ?? [];

  return (
    <>
      <Link
        href={backHref}
        className="mb-6 inline-block text-xs font-[650] text-cobalt no-underline"
      >
        ← {employeeName ? 'Employee record' : 'Dashboard'}
      </Link>
      <header className="mb-7 flex flex-col gap-5 min-[700px]:flex-row min-[700px]:items-end min-[700px]:justify-between">
        <div className="flex items-center gap-4">
          {employeeName && <EmployeeInitials name={employeeName} large />}
          <EmployeePageTitle
            eyebrow="CS Form No. 212 · Revised 2026 Draft"
            title={employeeName ? `${employeeName} · PDS` : 'My Personal Data Sheet'}
            description="Maintain personal, family, qualifications, work, voluntary, development, and WES draft information."
          />
        </div>

        {detail?.fieldScope === 'FULL' && workflowActions.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {workflowActions.map((action) => (
              <Button
                key={action}
                type="button"
                variant="secondary"
                size="default"
                disabled={workflowBusy}
                onClick={(event) =>
                  openWorkflow(action, event.currentTarget as unknown as { focus(): void })
                }
              >
                {workflowCopy[action].submit}
              </Button>
            ))}
          </div>
        )}
      </header>
      {canUpdate && (editable || canCreate) && (
        <Dialog
          presentation="form"
          open={open}
          onOpenChange={(next) => !submitting && setOpen(next)}
        >
          <DialogTrigger asChild>
            <Button variant="primary" size="default" onClick={openForm}>
              {editable ? 'Edit Draft PDS' : 'Create Draft PDS'}
            </Button>
          </DialogTrigger>
          <DialogContent
            aria-describedby="pds-dialog-description"
            onOpenAutoFocus={(event) => {
              if (!deficiencyField) return;
              event.preventDefault();
              setTimeout(() => {
                focusDeficiency(deficiencyField);
                setDeficiencyField(null);
              }, 50);
            }}
          >
            <DialogHeader>
              <div className="grid gap-1.5">
                <DialogTitle>{editable ? 'Edit Draft PDS' : 'Create Draft PDS'}</DialogTitle>
                <DialogDescription id="pds-dialog-description">
                  Items 1–30 and Work Experience Sheet rows are saved as one protected Draft. Empty
                  fields remain available for later completion.
                </DialogDescription>
              </div>
            </DialogHeader>
            <DialogBody>
              <form id="pds-form" className="grid gap-6" onSubmit={submit}>
                {error && (
                  <div
                    ref={errorRef}
                    tabIndex={-1}
                    role="alert"
                    className="rounded-[3px] border-l-2 border-[#b64040] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d] outline-none"
                  >
                    {error}
                  </div>
                )}
                <div className="grid gap-3 border-l-2 border-cobalt bg-pale-blue px-4 py-3 text-xs leading-5 text-[#34557e]">
                  <strong className="font-[680] text-midnight">Draft record</strong>
                  <span>
                    This record can be changed while it is Draft or Returned. Submission and
                    certification are separate workflows.
                  </span>
                </div>
                <TextField
                  label="As-of date"
                  type="date"
                  value={form.asOfDate}
                  onChange={(value) => setForm((current) => ({ ...current, asOfDate: value }))}
                  required
                />
                <FormSection item="01–09" title="Personal identity and physical information">
                  <div className="grid gap-4 min-[620px]:grid-cols-2">
                    <TextField
                      label="Surname"
                      field="personal.surname"
                      value={form.personal.surname}
                      onChange={(value) => changePersonal('surname', value)}
                    />
                    <TextField
                      label="First name"
                      field="personal.firstName"
                      value={form.personal.firstName}
                      onChange={(value) => changePersonal('firstName', value)}
                    />
                    <TextField
                      label="Name extension"
                      value={form.personal.nameExtension}
                      onChange={(value) => changePersonal('nameExtension', value)}
                    />
                    <TextField
                      label="Middle name"
                      value={form.personal.middleName}
                      onChange={(value) => changePersonal('middleName', value)}
                    />
                    <TextField
                      label="Birth date"
                      field="personal.birthDate"
                      type="date"
                      value={form.personal.birthDate}
                      onChange={(value) => changePersonal('birthDate', value)}
                    />
                    <TextField
                      label="Place of birth"
                      field="personal.birthPlace"
                      value={form.personal.birthPlace}
                      onChange={(value) => changePersonal('birthPlace', value)}
                    />
                    <SelectField
                      label="Sex at birth"
                      field="personal.sex"
                      value={form.personal.sex}
                      onChange={(value) => changePersonal('sex', value)}
                      options={[
                        ['FEMALE', 'Female'],
                        ['MALE', 'Male'],
                      ]}
                    />
                    <SelectField
                      label="Civil status"
                      field="personal.civilStatus"
                      value={form.personal.civilStatus}
                      onChange={(value) => changePersonal('civilStatus', value)}
                      options={[
                        ['SINGLE', 'Single'],
                        ['MARRIED', 'Married'],
                        ['WIDOWED', 'Widowed'],
                        ['SEPARATED', 'Separated'],
                        ['OTHER', 'Other/s'],
                      ]}
                    />
                    {form.personal.civilStatus === 'OTHER' && (
                      <TextField
                        label="Other/s civil status"
                        value={form.personal.civilStatusDetail}
                        onChange={(value) => changePersonal('civilStatusDetail', value)}
                        required
                      />
                    )}
                    <TextField
                      label="Height (metres)"
                      field="personal.heightMeters"
                      type="number"
                      min="0"
                      step="0.001"
                      value={form.personal.heightMeters}
                      onChange={(value) => changePersonal('heightMeters', value)}
                    />
                    <TextField
                      label="Weight (kilograms)"
                      field="personal.weightKilograms"
                      type="number"
                      min="0"
                      step="0.001"
                      value={form.personal.weightKilograms}
                      onChange={(value) => changePersonal('weightKilograms', value)}
                    />
                    <TextField
                      label="Blood type"
                      field="personal.bloodType"
                      value={form.personal.bloodType}
                      onChange={(value) => changePersonal('bloodType', value)}
                    />
                  </div>
                </FormSection>
                <FormSection item="10–15" title="Government and Agency identifiers">
                  <div className="grid gap-4 min-[620px]:grid-cols-2">
                    {personalTextFields.slice(6, 12).map(([key, label]) => (
                      <TextField
                        key={key}
                        label={label}
                        field={`personal.${key}`}
                        value={form.personal[key]}
                        onChange={(value) => changePersonal(key, value)}
                      />
                    ))}
                  </div>
                </FormSection>
                <FormSection item="16" title="Citizenship">
                  <div className="grid gap-4 min-[620px]:grid-cols-2">
                    <SelectField
                      label="Citizenship"
                      field="personal.citizenship"
                      value={form.personal.citizenship}
                      onChange={(value) => changePersonal('citizenship', value)}
                      options={[
                        ['FILIPINO', 'Filipino'],
                        ['DUAL_CITIZENSHIP', 'Dual citizenship'],
                      ]}
                    />
                    {form.personal.citizenship === 'DUAL_CITIZENSHIP' && (
                      <>
                        <SelectField
                          label="Dual citizenship by"
                          field="personal.dualCitizenshipType"
                          value={form.personal.dualCitizenshipType}
                          onChange={(value) => changePersonal('dualCitizenshipType', value)}
                          options={[
                            ['BY_BIRTH', 'Birth'],
                            ['BY_NATURALIZATION', 'Naturalization'],
                          ]}
                        />
                        <SelectField
                          label="Other citizenship country"
                          field="personal.dualCitizenshipCountry"
                          value={form.personal.dualCitizenshipCountry}
                          onChange={(value) => changePersonal('dualCitizenshipCountry', value)}
                          options={list.citizenshipCountries.map(
                            (country) => [country, country] as const,
                          )}
                          required
                        />
                      </>
                    )}
                  </div>
                </FormSection>
                <FormSection item="17–18" title="Residential and permanent address">
                  <div className="grid gap-5">
                    <div className="grid gap-3">
                      <h3 className="m-0 text-xs font-[680] text-ink">Residential address</h3>
                      <AddressFields
                        value={form.personal.residentialAddress}
                        fieldPrefix="personal.residentialAddress"
                        onChange={(key, value) => changeAddress('residentialAddress', key, value)}
                      />
                    </div>
                    <div className="grid gap-3">
                      <h3 className="m-0 text-xs font-[680] text-ink">Permanent address</h3>
                      <AddressFields
                        value={form.personal.permanentAddress}
                        fieldPrefix="personal.permanentAddress"
                        onChange={(key, value) => changeAddress('permanentAddress', key, value)}
                      />
                    </div>
                  </div>
                </FormSection>
                <FormSection item="19–21" title="Contact information">
                  <div className="grid gap-4 min-[620px]:grid-cols-2">
                    {personalTextFields.slice(12).map(([key, label]) => (
                      <TextField
                        key={key}
                        label={label}
                        field={`personal.${key}`}
                        type={key === 'emailAddress' ? 'email' : 'text'}
                        value={form.personal[key]}
                        onChange={(value) => changePersonal(key, value)}
                      />
                    ))}
                  </div>
                </FormSection>
                <FormSection item="22" title="Spouse">
                  <div className="grid gap-4">
                    <NameFields
                      value={form.spouse}
                      fieldPrefix="family.spouse"
                      onChange={changeSpouse}
                    />
                    <div className="grid gap-4 min-[620px]:grid-cols-2">
                      <TextField
                        label="Occupation"
                        field="family.spouse.occupation"
                        value={form.spouse.occupation}
                        onChange={(value) => changeSpouse('occupation', value)}
                      />
                      <TextField
                        label="Employer / business name"
                        field="family.spouse.employerBusinessName"
                        value={form.spouse.employerBusinessName}
                        onChange={(value) => changeSpouse('employerBusinessName', value)}
                      />
                      <TextField
                        label="Telephone"
                        field="family.spouse.telephoneNumber"
                        value={form.spouse.telephoneNumber}
                        onChange={(value) => changeSpouse('telephoneNumber', value)}
                      />
                    </div>
                    <h3 className="m-0 text-xs font-[680] text-ink">Spouse business address</h3>
                    <AddressFields
                      value={form.spouse.businessAddress}
                      fieldPrefix="family.spouse.businessAddress"
                      onChange={changeSpouseAddress}
                    />
                  </div>
                </FormSection>
                <FormSection item="23" title="Children">
                  <div className="grid gap-4">
                    {form.children.map((child, index) => (
                      <RepeatableRow
                        key={child.uiKey}
                        title="Child"
                        index={index}
                        total={form.children.length}
                        onMoveUp={() =>
                          setForm((current) => ({
                            ...current,
                            children: moveAt(current.children, index, -1),
                          }))
                        }
                        onMoveDown={() =>
                          setForm((current) => ({
                            ...current,
                            children: moveAt(current.children, index, 1),
                          }))
                        }
                        onRemove={() =>
                          setForm((current) => ({
                            ...current,
                            children: removeAt(current.children, index),
                          }))
                        }
                      >
                        <div className="grid gap-4 min-[620px]:grid-cols-2">
                          <TextField
                            label="Full name"
                            field={`family.children.${index}.fullName`}
                            value={child.fullName}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                children: updateAt(current.children, index, (item) => ({
                                  ...item,
                                  fullName: value,
                                })),
                              }))
                            }
                          />
                          <TextField
                            label="Date of birth"
                            field={`family.children.${index}.birthDate`}
                            type="date"
                            value={child.birthDate}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                children: updateAt(current.children, index, (item) => ({
                                  ...item,
                                  birthDate: value,
                                })),
                              }))
                            }
                          />
                        </div>
                      </RepeatableRow>
                    ))}
                    <Button
                      type="button"
                      variant="secondary"
                      size="default"
                      className="justify-self-start"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          children: [...current.children, blankChild()],
                        }))
                      }
                    >
                      Add child
                    </Button>
                  </div>
                </FormSection>
                <FormSection item="24" title="Father">
                  <NameFields
                    value={form.father}
                    fieldPrefix="family.father"
                    onChange={(key, value) => changeName('father', key, value)}
                  />
                </FormSection>
                <FormSection item="25" title="Mother’s maiden name">
                  <NameFields
                    value={form.mother}
                    fieldPrefix="family.mother"
                    onChange={(key, value) => changeName('mother', key, value)}
                    includeNameExtension={false}
                  />
                </FormSection>
                <FormSection item="WORK" title="Work experience">
                  <div className="grid gap-4">
                    {form.workExperience.length === 0 && (
                      <EmptyRows message="No work experience rows added yet." />
                    )}
                    {form.workExperience.map((row, index) => (
                      <RepeatableRow
                        key={row.uiKey}
                        title="Work experience"
                        index={index}
                        total={form.workExperience.length}
                        onMoveUp={() =>
                          setForm((current) => ({
                            ...current,
                            workExperience: moveAt(current.workExperience, index, -1),
                          }))
                        }
                        onMoveDown={() =>
                          setForm((current) => ({
                            ...current,
                            workExperience: moveAt(current.workExperience, index, 1),
                          }))
                        }
                        onRemove={() =>
                          (() => {
                            const removedKey = row.uiKey;
                            const hasWesBinding = form.wes.some((artifact) =>
                              artifact.entries.some(
                                (entry) => entry.workExperienceKey === removedKey,
                              ),
                            );
                            if (hasWesBinding) {
                              setError(
                                'This work row is linked to a WES entry. Select a new parent before saving.',
                              );
                            }
                            setForm((current) => ({
                              ...current,
                              workExperience: removeAt(current.workExperience, index),
                              wes: current.wes.map((artifact) => ({
                                ...artifact,
                                entries: artifact.entries.map((entry) =>
                                  entry.workExperienceKey === removedKey
                                    ? { ...entry, workExperienceKey: '' }
                                    : entry,
                                ),
                              })),
                            }));
                          })()
                        }
                      >
                        <div className="grid gap-4">
                          <ToggleField
                            label="Current work"
                            field={`workExperience.${index}.isCurrent`}
                            checked={row.isCurrent}
                            onChange={(checked) =>
                              setForm((current) => ({
                                ...current,
                                workExperience: updateAt(current.workExperience, index, (item) => ({
                                  ...item,
                                  isCurrent: checked,
                                  inclusiveTo: checked ? '' : item.inclusiveTo,
                                })),
                              }))
                            }
                          />
                          <div className="grid gap-4 min-[620px]:grid-cols-2">
                            <TextField
                              label="Inclusive from"
                              field={`workExperience.${index}.inclusiveFrom`}
                              type="date"
                              value={row.inclusiveFrom}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  workExperience: updateAt(
                                    current.workExperience,
                                    index,
                                    (item) => ({
                                      ...item,
                                      inclusiveFrom: value,
                                    }),
                                  ),
                                }))
                              }
                            />
                            <TextField
                              label="Inclusive to"
                              field={`workExperience.${index}.inclusiveTo`}
                              type="date"
                              value={row.inclusiveTo}
                              disabled={row.isCurrent}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  workExperience: updateAt(
                                    current.workExperience,
                                    index,
                                    (item) => ({
                                      ...item,
                                      inclusiveTo: value,
                                    }),
                                  ),
                                }))
                              }
                            />
                            <TextField
                              label="Position title"
                              field={`workExperience.${index}.positionTitle`}
                              value={row.positionTitle}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  workExperience: updateAt(
                                    current.workExperience,
                                    index,
                                    (item) => ({
                                      ...item,
                                      positionTitle: value,
                                    }),
                                  ),
                                }))
                              }
                            />
                            <TextField
                              label="Department / agency / office / company"
                              field={`workExperience.${index}.departmentAgencyOfficeCompany`}
                              value={row.departmentAgencyOfficeCompany}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  workExperience: updateAt(
                                    current.workExperience,
                                    index,
                                    (item) => ({
                                      ...item,
                                      departmentAgencyOfficeCompany: value,
                                    }),
                                  ),
                                }))
                              }
                            />
                            <TextField
                              label="Monthly salary"
                              field={`workExperience.${index}.monthlySalary`}
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.monthlySalary}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  workExperience: updateAt(
                                    current.workExperience,
                                    index,
                                    (item) => ({
                                      ...item,
                                      monthlySalary: value,
                                    }),
                                  ),
                                }))
                              }
                            />
                            <TextField
                              label="Salary / job / pay grade and step"
                              field={`workExperience.${index}.salaryGradeStep`}
                              value={row.salaryGradeStep}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  workExperience: updateAt(
                                    current.workExperience,
                                    index,
                                    (item) => ({
                                      ...item,
                                      salaryGradeStep: value,
                                    }),
                                  ),
                                }))
                              }
                            />
                            <TextField
                              label="Status of appointment"
                              field={`workExperience.${index}.appointmentStatus`}
                              value={row.appointmentStatus}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  workExperience: updateAt(
                                    current.workExperience,
                                    index,
                                    (item) => ({
                                      ...item,
                                      appointmentStatus: value,
                                    }),
                                  ),
                                }))
                              }
                            />
                            <SelectField
                              label="Government service"
                              field={`workExperience.${index}.governmentService`}
                              value={row.governmentService}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  workExperience: updateAt(
                                    current.workExperience,
                                    index,
                                    (item) => ({
                                      ...item,
                                      governmentService: value,
                                    }),
                                  ),
                                }))
                              }
                              options={workExperienceOptions}
                            />
                          </div>
                          <EvidenceFields
                            value={row}
                            options={evidenceOptions}
                            loading={evidenceLoading}
                            canBrowse={canBrowseEvidence}
                            onChange={(key, value) =>
                              setForm((current) => ({
                                ...current,
                                workExperience: updateAt(current.workExperience, index, (item) => ({
                                  ...item,
                                  [key]: value,
                                })),
                              }))
                            }
                          />
                        </div>
                      </RepeatableRow>
                    ))}
                    <Button
                      data-pds-field="workExperience"
                      type="button"
                      variant="secondary"
                      size="default"
                      className="justify-self-start"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          workExperience: [...current.workExperience, blankWorkExperience()],
                        }))
                      }
                    >
                      Add work experience
                    </Button>
                  </div>
                </FormSection>
                <FormSection item="VOL" title="Voluntary work">
                  <div className="grid gap-4">
                    {form.voluntaryWork.length === 0 && (
                      <EmptyRows message="No voluntary-work rows added yet." />
                    )}
                    {form.voluntaryWork.map((row, index) => (
                      <RepeatableRow
                        key={row.uiKey}
                        title="Voluntary work"
                        index={index}
                        total={form.voluntaryWork.length}
                        onMoveUp={() =>
                          setForm((current) => ({
                            ...current,
                            voluntaryWork: moveAt(current.voluntaryWork, index, -1),
                          }))
                        }
                        onMoveDown={() =>
                          setForm((current) => ({
                            ...current,
                            voluntaryWork: moveAt(current.voluntaryWork, index, 1),
                          }))
                        }
                        onRemove={() =>
                          setForm((current) => ({
                            ...current,
                            voluntaryWork: removeAt(current.voluntaryWork, index),
                          }))
                        }
                      >
                        <div className="grid gap-4 min-[620px]:grid-cols-2">
                          <TextField
                            label="Organization name and address"
                            field={`voluntaryWork.${index}.organizationNameAddress`}
                            value={row.organizationNameAddress}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                voluntaryWork: updateAt(current.voluntaryWork, index, (item) => ({
                                  ...item,
                                  organizationNameAddress: value,
                                })),
                              }))
                            }
                          />
                          <TextField
                            label="Position / nature of work"
                            field={`voluntaryWork.${index}.positionNatureOfWork`}
                            value={row.positionNatureOfWork}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                voluntaryWork: updateAt(current.voluntaryWork, index, (item) => ({
                                  ...item,
                                  positionNatureOfWork: value,
                                })),
                              }))
                            }
                          />
                          <TextField
                            label="Inclusive from"
                            field={`voluntaryWork.${index}.inclusiveFrom`}
                            type="date"
                            value={row.inclusiveFrom}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                voluntaryWork: updateAt(current.voluntaryWork, index, (item) => ({
                                  ...item,
                                  inclusiveFrom: value,
                                })),
                              }))
                            }
                          />
                          <TextField
                            label="Inclusive to"
                            field={`voluntaryWork.${index}.inclusiveTo`}
                            type="date"
                            value={row.inclusiveTo}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                voluntaryWork: updateAt(current.voluntaryWork, index, (item) => ({
                                  ...item,
                                  inclusiveTo: value,
                                })),
                              }))
                            }
                          />
                          <TextField
                            label="Number of hours"
                            field={`voluntaryWork.${index}.hours`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.hours}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                voluntaryWork: updateAt(current.voluntaryWork, index, (item) => ({
                                  ...item,
                                  hours: value,
                                })),
                              }))
                            }
                          />
                        </div>
                        <EvidenceFields
                          value={row}
                          options={evidenceOptions}
                          loading={evidenceLoading}
                          canBrowse={canBrowseEvidence}
                          onChange={(key, value) =>
                            setForm((current) => ({
                              ...current,
                              voluntaryWork: updateAt(current.voluntaryWork, index, (item) => ({
                                ...item,
                                [key]: value,
                              })),
                            }))
                          }
                        />
                      </RepeatableRow>
                    ))}
                    <Button
                      data-pds-field="voluntaryWork"
                      type="button"
                      variant="secondary"
                      size="default"
                      className="justify-self-start"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          voluntaryWork: [...current.voluntaryWork, blankVoluntaryWork()],
                        }))
                      }
                    >
                      Add voluntary work
                    </Button>
                  </div>
                </FormSection>
                <FormSection item="L&D" title="Learning and development">
                  <div className="grid gap-4">
                    {form.learningAndDevelopment.length === 0 && (
                      <EmptyRows message="No learning-and-development rows added yet." />
                    )}
                    {form.learningAndDevelopment.map((row, index) => (
                      <RepeatableRow
                        key={row.uiKey}
                        title="Learning and development"
                        index={index}
                        total={form.learningAndDevelopment.length}
                        onMoveUp={() =>
                          setForm((current) => ({
                            ...current,
                            learningAndDevelopment: moveAt(
                              current.learningAndDevelopment,
                              index,
                              -1,
                            ),
                          }))
                        }
                        onMoveDown={() =>
                          setForm((current) => ({
                            ...current,
                            learningAndDevelopment: moveAt(
                              current.learningAndDevelopment,
                              index,
                              1,
                            ),
                          }))
                        }
                        onRemove={() =>
                          setForm((current) => ({
                            ...current,
                            learningAndDevelopment: removeAt(current.learningAndDevelopment, index),
                          }))
                        }
                      >
                        <div className="grid gap-4 min-[620px]:grid-cols-2">
                          <TextField
                            label="Intervention / training title"
                            field={`learningAndDevelopment.${index}.interventionTitle`}
                            value={row.interventionTitle}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                learningAndDevelopment: updateAt(
                                  current.learningAndDevelopment,
                                  index,
                                  (item) => ({ ...item, interventionTitle: value }),
                                ),
                              }))
                            }
                          />
                          <TextField
                            label="Type"
                            field={`learningAndDevelopment.${index}.type`}
                            value={row.type}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                learningAndDevelopment: updateAt(
                                  current.learningAndDevelopment,
                                  index,
                                  (item) => ({ ...item, type: value }),
                                ),
                              }))
                            }
                          />
                          <TextField
                            label="Attendance from"
                            field={`learningAndDevelopment.${index}.attendanceFrom`}
                            type="date"
                            value={row.attendanceFrom}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                learningAndDevelopment: updateAt(
                                  current.learningAndDevelopment,
                                  index,
                                  (item) => ({ ...item, attendanceFrom: value }),
                                ),
                              }))
                            }
                          />
                          <TextField
                            label="Attendance to"
                            field={`learningAndDevelopment.${index}.attendanceTo`}
                            type="date"
                            value={row.attendanceTo}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                learningAndDevelopment: updateAt(
                                  current.learningAndDevelopment,
                                  index,
                                  (item) => ({ ...item, attendanceTo: value }),
                                ),
                              }))
                            }
                          />
                          <TextField
                            label="Number of hours"
                            field={`learningAndDevelopment.${index}.hours`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.hours}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                learningAndDevelopment: updateAt(
                                  current.learningAndDevelopment,
                                  index,
                                  (item) => ({ ...item, hours: value }),
                                ),
                              }))
                            }
                          />
                          <TextField
                            label="Conducted / sponsored by"
                            field={`learningAndDevelopment.${index}.conductedSponsoredBy`}
                            value={row.conductedSponsoredBy}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                learningAndDevelopment: updateAt(
                                  current.learningAndDevelopment,
                                  index,
                                  (item) => ({ ...item, conductedSponsoredBy: value }),
                                ),
                              }))
                            }
                          />
                        </div>
                        <EvidenceFields
                          value={row}
                          options={evidenceOptions}
                          loading={evidenceLoading}
                          canBrowse={canBrowseEvidence}
                          onChange={(key, value) =>
                            setForm((current) => ({
                              ...current,
                              learningAndDevelopment: updateAt(
                                current.learningAndDevelopment,
                                index,
                                (item) => ({ ...item, [key]: value }),
                              ),
                            }))
                          }
                        />
                      </RepeatableRow>
                    ))}
                    <Button
                      data-pds-field="learningAndDevelopment"
                      type="button"
                      variant="secondary"
                      size="default"
                      className="justify-self-start"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          learningAndDevelopment: [
                            ...current.learningAndDevelopment,
                            blankLearningDevelopment(),
                          ],
                        }))
                      }
                    >
                      Add learning and development
                    </Button>
                  </div>
                </FormSection>
                <FormSection item="WES" title="Work Experience Sheet">
                  <div className="grid gap-4">
                    {form.wes.length === 0 && (
                      <EmptyRows message="No Work Experience Sheet artifacts added yet." />
                    )}
                    {form.wes.map((artifact, artifactIndex) => (
                      <RepeatableRow
                        key={artifact.uiKey}
                        title="WES artifact"
                        index={artifactIndex}
                        total={form.wes.length}
                        onMoveUp={() =>
                          setForm((current) => ({
                            ...current,
                            wes: moveAt(current.wes, artifactIndex, -1),
                          }))
                        }
                        onMoveDown={() =>
                          setForm((current) => ({
                            ...current,
                            wes: moveAt(current.wes, artifactIndex, 1),
                          }))
                        }
                        onRemove={() =>
                          setForm((current) => ({
                            ...current,
                            wes: removeAt(current.wes, artifactIndex),
                          }))
                        }
                      >
                        <div className="grid gap-4">
                          <TextField
                            label="Context key"
                            value={artifact.contextKey}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                wes: updateAt(current.wes, artifactIndex, (item) => ({
                                  ...item,
                                  contextKey: value,
                                })),
                              }))
                            }
                          />
                          <EvidenceFields
                            value={artifact}
                            options={evidenceOptions}
                            loading={evidenceLoading}
                            canBrowse={canBrowseEvidence}
                            onChange={(key, value) =>
                              setForm((current) => ({
                                ...current,
                                wes: updateAt(current.wes, artifactIndex, (item) => ({
                                  ...item,
                                  [key]: value,
                                })),
                              }))
                            }
                          />
                          <div className="grid gap-4 min-[620px]:grid-cols-3">
                            <TextField
                              label="WES signature document ID"
                              value={artifact.signatureDocumentId}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  wes: updateAt(current.wes, artifactIndex, (item) => ({
                                    ...item,
                                    signatureDocumentId: value,
                                  })),
                                }))
                              }
                            />
                            <TextField
                              label="WES signature document version ID"
                              value={artifact.signatureDocumentVersionId}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  wes: updateAt(current.wes, artifactIndex, (item) => ({
                                    ...item,
                                    signatureDocumentVersionId: value,
                                  })),
                                }))
                              }
                            />
                            <TextField
                              label="WES signed date"
                              type="date"
                              value={artifact.signedAt}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  wes: updateAt(current.wes, artifactIndex, (item) => ({
                                    ...item,
                                    signedAt: value,
                                  })),
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-4">
                            {artifact.entries.map((entry, entryIndex) => (
                              <RepeatableRow
                                key={entry.uiKey}
                                title="WES entry"
                                index={entryIndex}
                                total={artifact.entries.length}
                                onMoveUp={() =>
                                  setForm((current) => ({
                                    ...current,
                                    wes: updateAt(current.wes, artifactIndex, (item) => ({
                                      ...item,
                                      entries: moveAt(item.entries, entryIndex, -1),
                                    })),
                                  }))
                                }
                                onMoveDown={() =>
                                  setForm((current) => ({
                                    ...current,
                                    wes: updateAt(current.wes, artifactIndex, (item) => ({
                                      ...item,
                                      entries: moveAt(item.entries, entryIndex, 1),
                                    })),
                                  }))
                                }
                                onRemove={() =>
                                  setForm((current) => ({
                                    ...current,
                                    wes: updateAt(current.wes, artifactIndex, (item) => ({
                                      ...item,
                                      entries: removeAt(item.entries, entryIndex),
                                    })),
                                  }))
                                }
                              >
                                <div className="grid gap-4">
                                  <SelectField
                                    label="Parent work-experience row"
                                    value={entry.workExperienceKey}
                                    onChange={(value) =>
                                      setForm((current) => ({
                                        ...current,
                                        wes: updateAt(current.wes, artifactIndex, (item) => ({
                                          ...item,
                                          entries: updateAt(item.entries, entryIndex, (row) => ({
                                            ...row,
                                            workExperienceKey: value,
                                          })),
                                        })),
                                      }))
                                    }
                                    options={workOptions}
                                    required
                                    placeholder={
                                      workOptions.length === 0
                                        ? 'Add a work-experience row first'
                                        : 'Select a parent row'
                                    }
                                  />
                                  <div className="grid gap-4 min-[620px]:grid-cols-2">
                                    <TextField
                                      label="Duration text"
                                      field={`wes.${artifactIndex}.entries.${entryIndex}.durationText`}
                                      value={entry.durationText}
                                      onChange={(value) =>
                                        setForm((current) => ({
                                          ...current,
                                          wes: updateAt(current.wes, artifactIndex, (item) => ({
                                            ...item,
                                            entries: updateAt(item.entries, entryIndex, (row) => ({
                                              ...row,
                                              durationText: value,
                                            })),
                                          })),
                                        }))
                                      }
                                      required
                                    />
                                    <TextField
                                      label="Position"
                                      field={`wes.${artifactIndex}.entries.${entryIndex}.position`}
                                      value={entry.position}
                                      onChange={(value) =>
                                        setForm((current) => ({
                                          ...current,
                                          wes: updateAt(current.wes, artifactIndex, (item) => ({
                                            ...item,
                                            entries: updateAt(item.entries, entryIndex, (row) => ({
                                              ...row,
                                              position: value,
                                            })),
                                          })),
                                        }))
                                      }
                                      required
                                    />
                                    <TextField
                                      label="Office / unit"
                                      field={`wes.${artifactIndex}.entries.${entryIndex}.officeUnit`}
                                      value={entry.officeUnit}
                                      onChange={(value) =>
                                        setForm((current) => ({
                                          ...current,
                                          wes: updateAt(current.wes, artifactIndex, (item) => ({
                                            ...item,
                                            entries: updateAt(item.entries, entryIndex, (row) => ({
                                              ...row,
                                              officeUnit: value,
                                            })),
                                          })),
                                        }))
                                      }
                                      required
                                    />
                                    <TextField
                                      label="Immediate supervisor"
                                      field={`wes.${artifactIndex}.entries.${entryIndex}.immediateSupervisor`}
                                      value={entry.immediateSupervisor}
                                      onChange={(value) =>
                                        setForm((current) => ({
                                          ...current,
                                          wes: updateAt(current.wes, artifactIndex, (item) => ({
                                            ...item,
                                            entries: updateAt(item.entries, entryIndex, (row) => ({
                                              ...row,
                                              immediateSupervisor: value,
                                            })),
                                          })),
                                        }))
                                      }
                                      required
                                    />
                                    <TextField
                                      label="Agency / organization / location"
                                      field={`wes.${artifactIndex}.entries.${entryIndex}.agencyOrganizationLocation`}
                                      value={entry.agencyOrganizationLocation}
                                      onChange={(value) =>
                                        setForm((current) => ({
                                          ...current,
                                          wes: updateAt(current.wes, artifactIndex, (item) => ({
                                            ...item,
                                            entries: updateAt(item.entries, entryIndex, (row) => ({
                                              ...row,
                                              agencyOrganizationLocation: value,
                                            })),
                                          })),
                                        }))
                                      }
                                      required
                                    />
                                  </div>
                                  <TextAreaField
                                    label="Accomplishments / contributions"
                                    value={entry.accomplishments}
                                    onChange={(value) =>
                                      setForm((current) => ({
                                        ...current,
                                        wes: updateAt(current.wes, artifactIndex, (item) => ({
                                          ...item,
                                          entries: updateAt(item.entries, entryIndex, (row) => ({
                                            ...row,
                                            accomplishments: value,
                                          })),
                                        })),
                                      }))
                                    }
                                  />
                                  <TextAreaField
                                    label="Summary of actual duties"
                                    field={`wes.${artifactIndex}.entries.${entryIndex}.actualDuties`}
                                    value={entry.actualDuties}
                                    onChange={(value) =>
                                      setForm((current) => ({
                                        ...current,
                                        wes: updateAt(current.wes, artifactIndex, (item) => ({
                                          ...item,
                                          entries: updateAt(item.entries, entryIndex, (row) => ({
                                            ...row,
                                            actualDuties: value,
                                          })),
                                        })),
                                      }))
                                    }
                                    required
                                  />
                                </div>
                              </RepeatableRow>
                            ))}
                            <Button
                              data-pds-field="wes.entries"
                              type="button"
                              variant="secondary"
                              size="default"
                              className="justify-self-start"
                              onClick={() =>
                                setForm((current) => ({
                                  ...current,
                                  wes: updateAt(current.wes, artifactIndex, (item) => ({
                                    ...item,
                                    entries: [...item.entries, blankWesEntry()],
                                  })),
                                }))
                              }
                            >
                              Add WES entry
                            </Button>
                          </div>
                        </div>
                      </RepeatableRow>
                    ))}
                    <Button
                      type="button"
                      variant="secondary"
                      size="default"
                      className="justify-self-start"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          wes: [...current.wes, blankWes()],
                        }))
                      }
                    >
                      Add WES artifact
                    </Button>
                  </div>
                </FormSection>
                <FormSection item="26" title="Educational background">
                  <div className="grid gap-4">
                    {form.education.map((record, index) => (
                      <div
                        key={index}
                        className="grid gap-3 rounded-[3px] border border-line bg-[#fafbfd] p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <strong className="text-xs font-[680] text-ink">
                            Education {index + 1}
                          </strong>
                          <RowButtons
                            label="education row"
                            index={index}
                            count={form.education.length}
                            onMove={(offset) =>
                              setForm((current) => ({
                                ...current,
                                education: moveAt(current.education, index, offset),
                              }))
                            }
                            onRemove={() =>
                              setForm((current) => ({
                                ...current,
                                education: current.education.filter(
                                  (_, recordIndex) => recordIndex !== index,
                                ),
                              }))
                            }
                          />
                        </div>
                        <div className="grid gap-4 min-[620px]:grid-cols-2">
                          <SelectField
                            label="Education level"
                            field={`education.${index}.level`}
                            value={record.level}
                            onChange={(value) => changeEducation(index, 'level', value)}
                            options={educationLevelOptions}
                            required
                          />
                          <TextField
                            label="Name of school"
                            field={`education.${index}.schoolName`}
                            value={record.schoolName}
                            onChange={(value) => changeEducation(index, 'schoolName', value)}
                            required
                          />
                          <TextField
                            label="Basic education / degree / course"
                            field={`education.${index}.degreeCourse`}
                            value={record.degreeCourse}
                            onChange={(value) => changeEducation(index, 'degreeCourse', value)}
                            required
                          />
                          <TextField
                            label="Period of attendance"
                            field={`education.${index}.periodOfAttendance`}
                            value={record.periodOfAttendance}
                            onChange={(value) =>
                              changeEducation(index, 'periodOfAttendance', value)
                            }
                            required
                          />
                          <TextField
                            label="Highest level / units earned"
                            field={`education.${index}.highestLevelUnits`}
                            value={record.highestLevelUnits}
                            onChange={(value) => changeEducation(index, 'highestLevelUnits', value)}
                          />
                          <TextField
                            label="Year graduated"
                            field={`education.${index}.yearGraduated`}
                            type="number"
                            min="1900"
                            value={record.yearGraduated}
                            onChange={(value) => changeEducation(index, 'yearGraduated', value)}
                          />
                          <TextField
                            label="Scholarship / academic honors"
                            field={`education.${index}.honors`}
                            value={record.honors}
                            onChange={(value) => changeEducation(index, 'honors', value)}
                          />
                          <TextField
                            label="Evidence document ID"
                            value={record.documentId}
                            onChange={(value) => changeEducation(index, 'documentId', value)}
                          />
                          <TextField
                            label="Evidence document version ID"
                            value={record.documentVersionId}
                            onChange={(value) => changeEducation(index, 'documentVersionId', value)}
                          />
                        </div>
                      </div>
                    ))}
                    <Button
                      data-pds-field="education"
                      type="button"
                      variant="secondary"
                      size="default"
                      className="justify-self-start"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          education: [...current.education, blankEducation()],
                        }))
                      }
                    >
                      Add education row
                    </Button>
                  </div>
                </FormSection>
                <FormSection item="27" title="Civil-service eligibility">
                  <div className="grid gap-4">
                    <datalist id="pds-eligibility-categories">
                      {eligibilityCategoryOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                    {form.eligibility.map((record, index) => (
                      <div
                        key={index}
                        className="grid gap-3 rounded-[3px] border border-line bg-[#fafbfd] p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <strong className="text-xs font-[680] text-ink">
                            Eligibility {index + 1}
                          </strong>
                          <RowButtons
                            label="eligibility row"
                            index={index}
                            count={form.eligibility.length}
                            onMove={(offset) =>
                              setForm((current) => ({
                                ...current,
                                eligibility: moveAt(current.eligibility, index, offset),
                              }))
                            }
                            onRemove={() =>
                              setForm((current) => ({
                                ...current,
                                eligibility: current.eligibility.filter(
                                  (_, recordIndex) => recordIndex !== index,
                                ),
                              }))
                            }
                          />
                        </div>
                        <div className="grid gap-4 min-[620px]:grid-cols-2">
                          <TextField
                            label="Eligibility name / category"
                            field={`eligibility.${index}.eligibilityName`}
                            value={record.eligibilityName}
                            list="pds-eligibility-categories"
                            onChange={(value) => changeEligibility(index, 'eligibilityName', value)}
                            required
                          />
                          <TextField
                            label="Rating"
                            field={`eligibility.${index}.rating`}
                            value={record.rating}
                            onChange={(value) => changeEligibility(index, 'rating', value)}
                          />
                          <TextField
                            label="Date of examination / conferment"
                            field={`eligibility.${index}.examDate`}
                            type="date"
                            value={record.examDate}
                            onChange={(value) => changeEligibility(index, 'examDate', value)}
                          />
                          <TextField
                            label="Place of examination / conferment"
                            field={`eligibility.${index}.examPlace`}
                            value={record.examPlace}
                            onChange={(value) => changeEligibility(index, 'examPlace', value)}
                          />
                          <TextField
                            label="License number"
                            field={`eligibility.${index}.licenseNo`}
                            value={record.licenseNo}
                            onChange={(value) => changeEligibility(index, 'licenseNo', value)}
                          />
                          <TextField
                            label="License date of validity"
                            field={`eligibility.${index}.validUntil`}
                            type="date"
                            value={record.validUntil}
                            onChange={(value) => changeEligibility(index, 'validUntil', value)}
                          />
                          <TextField
                            label="Evidence document ID"
                            value={record.documentId}
                            onChange={(value) => changeEligibility(index, 'documentId', value)}
                          />
                          <TextField
                            label="Evidence document version ID"
                            value={record.documentVersionId}
                            onChange={(value) =>
                              changeEligibility(index, 'documentVersionId', value)
                            }
                          />
                        </div>
                      </div>
                    ))}
                    <Button
                      data-pds-field="eligibility"
                      type="button"
                      variant="secondary"
                      size="default"
                      className="justify-self-start"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          eligibility: [...current.eligibility, blankEligibility()],
                        }))
                      }
                    >
                      Add eligibility row
                    </Button>
                  </div>
                </FormSection>
                <FormSection item="31–33" title="Other information">
                  <div className="grid gap-4">
                    <TextAreaField
                      label="Special skills and hobbies"
                      value={form.otherInformation.specialSkillsHobbies}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          otherInformation: {
                            ...current.otherInformation,
                            specialSkillsHobbies: value,
                          },
                        }))
                      }
                    />
                    <TextAreaField
                      label="Non-academic distinctions"
                      value={form.otherInformation.nonAcademicDistinctions}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          otherInformation: {
                            ...current.otherInformation,
                            nonAcademicDistinctions: value,
                          },
                        }))
                      }
                    />
                    <TextAreaField
                      label="Membership in associations"
                      value={form.otherInformation.memberships}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          otherInformation: { ...current.otherInformation, memberships: value },
                        }))
                      }
                    />
                  </div>
                </FormSection>
                <FormSection item="34–40" title="Declarations">
                  <div className="grid gap-4">
                    {declarationFields.map(([key, label, detailsKey]) => (
                      <div
                        key={key}
                        className="grid gap-3 rounded-[3px] border border-line bg-[#fafbfd] p-4"
                      >
                        <SelectField
                          label={label}
                          field={`declarations.${declarationApiFields[key]}`}
                          value={form.declarations[key]}
                          onChange={(value) =>
                            setForm((current) => ({
                              ...current,
                              declarations: {
                                ...current.declarations,
                                [key]: value,
                                ...(value !== 'YES'
                                  ? {
                                      [detailsKey]: '',
                                      ...(key === 'criminalCharge'
                                        ? {
                                            criminalChargeDateFiled: '',
                                            criminalChargeDateFiledUnknown: 'NO',
                                            criminalChargeStatus: '',
                                          }
                                        : {}),
                                      ...(key === 'separatedFromService'
                                        ? { separationMode: '' }
                                        : {}),
                                      ...(key === 'immigrant' ? { immigrantCountry: '' } : {}),
                                      ...(key === 'disability' ? { disabilityIdNumber: '' } : {}),
                                      ...(key === 'soloParent' ? { soloParentIdNumber: '' } : {}),
                                    }
                                  : {}),
                              },
                            }))
                          }
                          options={yesNoOptions}
                          required
                        />
                        {form.declarations[key] === 'YES' && (
                          <TextAreaField
                            label={`${label} details`}
                            field={`declarations.${declarationApiFields[detailsKey]}`}
                            value={form.declarations[detailsKey]}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                declarations: { ...current.declarations, [detailsKey]: value },
                              }))
                            }
                            required
                          />
                        )}
                        {key === 'criminalCharge' && form.declarations[key] === 'YES' && (
                          <div className="grid gap-4 min-[620px]:grid-cols-2">
                            <TextField
                              label="Date filed"
                              field="declarations.criminalChargeDateFiled"
                              type="date"
                              value={form.declarations.criminalChargeDateFiled}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  declarations: {
                                    ...current.declarations,
                                    criminalChargeDateFiled: value,
                                    ...(value ? { criminalChargeDateFiledUnknown: 'NO' } : {}),
                                  },
                                }))
                              }
                            />
                            <SelectField
                              label="Date filed unknown?"
                              field="declarations.criminalChargeDateFiledUnknown"
                              value={form.declarations.criminalChargeDateFiledUnknown}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  declarations: {
                                    ...current.declarations,
                                    criminalChargeDateFiledUnknown: value,
                                    ...(value === 'YES' ? { criminalChargeDateFiled: '' } : {}),
                                  },
                                }))
                              }
                              options={yesNoOptions}
                            />
                            <TextField
                              label="Case status"
                              field="declarations.criminalChargeStatus"
                              value={form.declarations.criminalChargeStatus}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  declarations: {
                                    ...current.declarations,
                                    criminalChargeStatus: value,
                                  },
                                }))
                              }
                              required
                            />
                          </div>
                        )}
                        {key === 'separatedFromService' && form.declarations[key] === 'YES' && (
                          <TextField
                            label="Separation mode"
                            field="declarations.separationMode"
                            value={form.declarations.separationMode}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                declarations: { ...current.declarations, separationMode: value },
                              }))
                            }
                            required
                          />
                        )}
                        {key === 'immigrant' && form.declarations[key] === 'YES' && (
                          <SelectField
                            label="Country of immigration or permanent residence"
                            field="declarations.immigrantCountry"
                            value={form.declarations.immigrantCountry}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                declarations: {
                                  ...current.declarations,
                                  immigrantCountry: value,
                                },
                              }))
                            }
                            options={list.citizenshipCountries.map(
                              (country) => [country, country] as const,
                            )}
                            required
                          />
                        )}
                        {key === 'disability' && form.declarations[key] === 'YES' && (
                          <TextField
                            label="Disability ID number"
                            field="declarations.disabilityIdNumber"
                            value={form.declarations.disabilityIdNumber}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                declarations: {
                                  ...current.declarations,
                                  disabilityIdNumber: value,
                                },
                              }))
                            }
                            required
                          />
                        )}
                        {key === 'soloParent' && form.declarations[key] === 'YES' && (
                          <TextField
                            label="Solo parent ID number"
                            field="declarations.soloParentIdNumber"
                            value={form.declarations.soloParentIdNumber}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                declarations: {
                                  ...current.declarations,
                                  soloParentIdNumber: value,
                                },
                              }))
                            }
                            required
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </FormSection>
                <FormSection item="41" title="References">
                  <div className="grid gap-4">
                    {form.references.length === 0 && (
                      <EmptyRows message="No references added yet." />
                    )}
                    {form.references.map((record, index) => (
                      <RepeatableRow
                        key={record.uiKey}
                        title="Reference"
                        index={index}
                        total={form.references.length}
                        onMoveUp={() =>
                          setForm((current) => ({
                            ...current,
                            references: moveAt(current.references, index, -1),
                          }))
                        }
                        onMoveDown={() =>
                          setForm((current) => ({
                            ...current,
                            references: moveAt(current.references, index, 1),
                          }))
                        }
                        onRemove={() =>
                          setForm((current) => ({
                            ...current,
                            references: removeAt(current.references, index),
                          }))
                        }
                      >
                        <div className="grid gap-4 min-[620px]:grid-cols-3">
                          <TextField
                            label="Reference name"
                            field={`references.${index}.name`}
                            value={record.name}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                references: updateAt(current.references, index, (item) => ({
                                  ...item,
                                  name: value,
                                })),
                              }))
                            }
                          />
                          <TextField
                            label="Reference address"
                            field={`references.${index}.address`}
                            value={record.address}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                references: updateAt(current.references, index, (item) => ({
                                  ...item,
                                  address: value,
                                })),
                              }))
                            }
                          />
                          <TextField
                            label="Reference telephone"
                            field={`references.${index}.contact`}
                            value={record.telephoneNumber}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                references: updateAt(current.references, index, (item) => ({
                                  ...item,
                                  telephoneNumber: value,
                                })),
                              }))
                            }
                          />
                        </div>
                      </RepeatableRow>
                    ))}
                    <Button
                      data-pds-field="references"
                      type="button"
                      variant="secondary"
                      size="default"
                      className="justify-self-start"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          references: [...current.references, blankReference()],
                        }))
                      }
                    >
                      Add reference
                    </Button>
                  </div>
                </FormSection>
                <FormSection item="42" title="Certification and evidence">
                  <div className="grid gap-3 rounded-[3px] border border-line bg-[#fafbfd] p-4">
                    <strong className="text-xs font-[680] text-ink">
                      Employee certification statements
                    </strong>
                    <p className="text-sm leading-6 text-ink-muted">
                      {pdsCertificationStatements.truthDeclaration}
                    </p>
                    <ToggleField
                      label="Truth declaration accepted"
                      field="certification.truthDeclarationAccepted"
                      checked={form.certification.truthDeclarationAccepted}
                      onChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            truthDeclarationAccepted: checked,
                          },
                        }))
                      }
                    />
                    <p className="text-sm leading-6 text-ink-muted">
                      {pdsCertificationStatements.verificationAuthorization}
                    </p>
                    <ToggleField
                      label="Verification authorization accepted"
                      field="certification.verificationAuthorizationAccepted"
                      checked={form.certification.verificationAuthorizationAccepted}
                      onChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            verificationAuthorizationAccepted: checked,
                          },
                        }))
                      }
                    />
                    <p className="text-sm leading-6 text-ink-muted">
                      {pdsCertificationStatements.misrepresentationWarning}
                    </p>
                    <ToggleField
                      label="Misrepresentation warning accepted"
                      field="certification.misrepresentationWarningAccepted"
                      checked={form.certification.misrepresentationWarningAccepted}
                      onChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            misrepresentationWarningAccepted: checked,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-4 min-[620px]:grid-cols-2">
                    <TextField
                      label="Government ID type"
                      value={form.certification.governmentIdType}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: { ...current.certification, governmentIdType: value },
                        }))
                      }
                    />
                    <TextField
                      label="Government ID number"
                      value={form.certification.governmentIdNumber}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            governmentIdNumber: value,
                          },
                        }))
                      }
                    />
                    <TextField
                      label="Government ID issued date"
                      type="date"
                      value={form.certification.governmentIdIssuedDate}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            governmentIdIssuedDate: value,
                          },
                        }))
                      }
                    />
                    <TextField
                      label="Government ID issued place"
                      value={form.certification.governmentIdIssuedPlace}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            governmentIdIssuedPlace: value,
                          },
                        }))
                      }
                    />
                    <TextField
                      label="Photo document ID"
                      value={form.certification.photoDocumentId}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: { ...current.certification, photoDocumentId: value },
                        }))
                      }
                    />
                    <TextField
                      label="Photo document version ID"
                      value={form.certification.photoDocumentVersionId}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            photoDocumentVersionId: value,
                          },
                        }))
                      }
                    />
                    <TextField
                      label="Signature document ID"
                      value={form.certification.signatureDocumentId}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            signatureDocumentId: value,
                          },
                        }))
                      }
                    />
                    <TextField
                      label="Signature document version ID"
                      value={form.certification.signatureDocumentVersionId}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            signatureDocumentVersionId: value,
                          },
                        }))
                      }
                    />
                    <TextField
                      label="Employee signature date"
                      type="date"
                      value={form.certification.employeeSignatureDate}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            employeeSignatureDate: value,
                          },
                        }))
                      }
                    />
                    <TextField
                      label="Thumbmark document ID"
                      value={form.certification.thumbmarkDocumentId}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            thumbmarkDocumentId: value,
                          },
                        }))
                      }
                    />
                    <TextField
                      label="Thumbmark document version ID"
                      value={form.certification.thumbmarkDocumentVersionId}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            thumbmarkDocumentVersionId: value,
                          },
                        }))
                      }
                    />
                    <TextField
                      label="Oath administrator signature document ID"
                      value={form.certification.oathAdminSignatureDocumentId}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            oathAdminSignatureDocumentId: value,
                          },
                        }))
                      }
                    />
                    <TextField
                      label="Oath administrator signature document version ID"
                      value={form.certification.oathAdminSignatureDocumentVersionId}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            oathAdminSignatureDocumentVersionId: value,
                          },
                        }))
                      }
                    />
                    <TextField
                      label="Subscribed and sworn date"
                      type="date"
                      value={form.certification.oathDate}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: { ...current.certification, oathDate: value },
                        }))
                      }
                    />
                    <TextField
                      label="Oath administration date"
                      type="date"
                      value={form.certification.oathAdministeredAt}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            oathAdministeredAt: value,
                          },
                        }))
                      }
                    />
                    <TextField
                      label="Administering officer"
                      value={form.certification.oathAdministeredBy}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            oathAdministeredBy: value,
                          },
                        }))
                      }
                    />
                    <TextAreaField
                      label="Subscribed and sworn text"
                      value={form.certification.subscribedAndSwornText}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          certification: {
                            ...current.certification,
                            subscribedAndSwornText: value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-4 rounded-[3px] border border-line bg-[#fafbfd] p-4">
                    <strong className="text-xs font-[680] text-ink">Per-page signatures</strong>
                    {form.certification.pageSignatures.map((signature, index) => (
                      <div key={signature.pageNo} className="grid gap-4 min-[620px]:grid-cols-3">
                        <TextField
                          label={`Page ${signature.pageNo} signature document ID`}
                          value={signature.signatureDocumentId}
                          onChange={(value) =>
                            setForm((current) => ({
                              ...current,
                              certification: {
                                ...current.certification,
                                pageSignatures: updateAt(
                                  current.certification.pageSignatures,
                                  index,
                                  (item) => ({ ...item, signatureDocumentId: value }),
                                ),
                              },
                            }))
                          }
                        />
                        <TextField
                          label={`Page ${signature.pageNo} signature document version ID`}
                          value={signature.signatureDocumentVersionId}
                          onChange={(value) =>
                            setForm((current) => ({
                              ...current,
                              certification: {
                                ...current.certification,
                                pageSignatures: updateAt(
                                  current.certification.pageSignatures,
                                  index,
                                  (item) => ({ ...item, signatureDocumentVersionId: value }),
                                ),
                              },
                            }))
                          }
                        />
                        <TextField
                          label={`Page ${signature.pageNo} signed date`}
                          type="date"
                          value={signature.signedAt}
                          onChange={(value) =>
                            setForm((current) => ({
                              ...current,
                              certification: {
                                ...current.certification,
                                pageSignatures: updateAt(
                                  current.certification.pageSignatures,
                                  index,
                                  (item) => ({ ...item, signedAt: value }),
                                ),
                              },
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </FormSection>
              </form>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary" size="default" disabled={submitting}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                form="pds-form"
                variant="primary"
                size="default"
                disabled={submitting}
              >
                {submitting ? 'Saving…' : 'Save Draft'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {versionError ? <p role="alert">{versionError}</p> : null}

      <WorkflowDialog
        action={workflowAction}
        busy={workflowBusy}
        error={workflowError}
        reason={workflowReason}
        onReasonChange={setWorkflowReason}
        onClose={closeWorkflow}
        onSubmit={submitWorkflow}
      />

      {message && (
        <p
          role="status"
          className={`mb-5 text-xs ${messageTone === 'ok' ? 'text-[#27633b]' : 'text-[#8f2d2d]'}`}
        >
          {message}
        </p>
      )}

      <div hidden={open}>
        <div className="mb-5 grid gap-4 min-[761px]:grid-cols-[minmax(0,1.5fr)_minmax(220px,.7fr)]">
          <section
            className="rounded-[5px] border border-line bg-paper"
            aria-labelledby="pds-record-heading"
          >
            <header className="flex min-h-[58px] items-center justify-between gap-4 border-b border-line px-5">
              <div>
                <p className="m-0 font-mono text-[10px] font-bold tracking-[.1em] text-cobalt">
                  C1
                </p>
                <h2 id="pds-record-heading" className="mt-1 mb-0 text-sm font-[680] text-midnight">
                  PDS draft information
                </h2>
              </div>
              {detail && <StatusBadge status={detail.status} />}
            </header>
            {!detail ? (
              <div className="grid gap-2 px-5 py-8">
                <strong className="text-sm font-[650] text-midnight">No Draft PDS yet.</strong>
                <p className="m-0 max-w-[560px] text-sm leading-6 text-muted">
                  Create the first Draft to begin recording personal, family, work, voluntary, and
                  learning history plus WES rows.
                </p>
              </div>
            ) : detail.fieldScope === 'REDACTED' ? (
              <div className="border-l-2 border-[#d99a32] bg-[#fff9ec] px-5 py-5 text-sm leading-6 text-[#70490f]">
                Personal, family, work, development, and WES fields are withheld for this access
                scope. Version metadata is visible for Agency-safe record history.
              </div>
            ) : (
              <div className="grid gap-7 px-5 py-6 min-[700px]:px-8">
                <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-3">
                  <DetailValue label="Version" value={`v${detail.versionNo}`} />
                  <DetailValue label="As of" value={formatEmployeeDate(detail.asOfDate)} />
                  <DetailValue label="Form contract" value={detail.formVersion} />
                </dl>
                <div className="grid gap-4">
                  <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                    Items 1–16
                  </h3>
                  <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-3">
                    <DetailValue
                      label="Name"
                      value={
                        personal
                          ? [
                              personal.firstName,
                              personal.middleName,
                              personal.surname,
                              personal.nameExtension,
                            ]
                              .filter(Boolean)
                              .join(' ')
                          : null
                      }
                    />
                    <DetailValue
                      label="Birth date"
                      value={personal?.birthDate ? formatEmployeeDate(personal.birthDate) : null}
                    />
                    <DetailValue label="Birth place" value={personal?.birthPlace} />
                    <DetailValue
                      label="Sex at birth"
                      value={personal?.sex ? titleCase(personal.sex) : null}
                    />
                    <DetailValue
                      label="Civil status"
                      value={personal?.civilStatus ? titleCase(personal.civilStatus) : null}
                    />
                    <DetailValue label="Citizenship" value={personal?.citizenship} />
                    <DetailValue label="Height (m)" value={personal?.heightMeters} />
                    <DetailValue label="Weight (kg)" value={personal?.weightKilograms} />
                    <DetailValue label="Blood type" value={personal?.bloodType} />
                  </dl>
                </div>
                <div className="grid gap-4">
                  <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                    Items 17–21
                  </h3>
                  <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                    <DetailValue
                      label="Residential address"
                      value={
                        personal?.residentialAddress
                          ? Object.values(personal.residentialAddress).filter(Boolean).join(', ')
                          : null
                      }
                    />
                    <DetailValue
                      label="Permanent address"
                      value={
                        personal?.permanentAddress
                          ? Object.values(personal.permanentAddress).filter(Boolean).join(', ')
                          : null
                      }
                    />
                    <DetailValue label="Telephone" value={personal?.telephoneNumber} />
                    <DetailValue label="Mobile" value={personal?.mobileNumber} />
                    <DetailValue label="Email" value={personal?.emailAddress} />
                  </dl>
                </div>
                <div className="grid gap-4">
                  <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                    Items 22–25 · Family
                  </h3>
                  <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                    <DetailValue label="Spouse" value={family?.spouse?.fullName} />
                    <DetailValue
                      label="Children"
                      value={
                        family
                          ? family.children
                              .map((child) => child.fullName)
                              .filter(Boolean)
                              .join(', ') || null
                          : null
                      }
                    />
                    <DetailValue label="Father" value={family?.father?.fullName} />
                    <DetailValue label="Mother’s maiden name" value={family?.mother?.fullName} />
                  </dl>
                </div>
                <div className="grid gap-4">
                  <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                    Work experience
                  </h3>
                  {detailWorkExperience.length === 0 ? (
                    <EmptyRows message="No work-experience rows recorded." />
                  ) : (
                    <div className="grid gap-4">
                      {detailWorkExperience.map((row, index) => (
                        <div
                          key={row.id ?? `work-${index}`}
                          className="grid gap-4 rounded-[3px] border border-line bg-[#fafbfd] p-4"
                        >
                          <strong className="text-xs font-[680] text-ink">
                            Work experience {index + 1}
                          </strong>
                          <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                            <DetailValue
                              label="Inclusive dates"
                              value={sequenceLabel(
                                stringValue(row.inclusiveFrom),
                                stringValue(row.inclusiveTo),
                                Boolean(row.isCurrent),
                              )}
                            />
                            <DetailValue label="Position title" value={row.positionTitle} />
                            <DetailValue
                              label="Department / agency / office / company"
                              value={row.departmentAgencyOfficeCompany}
                            />
                            <DetailValue label="Monthly salary" value={row.monthlySalary} />
                            <DetailValue label="Salary grade / step" value={row.salaryGradeStep} />
                            <DetailValue
                              label="Status of appointment"
                              value={row.appointmentStatus}
                            />
                            <DetailValue
                              label="Government service"
                              value={
                                row.governmentService === 'Y'
                                  ? 'Yes'
                                  : row.governmentService === 'N'
                                    ? 'No'
                                    : null
                              }
                            />
                            <DetailValue label="Evidence document ID" value={row.documentId} />
                            <DetailValue
                              label="Evidence document version ID"
                              value={row.documentVersionId}
                            />
                          </dl>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid gap-4">
                  <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                    Voluntary work
                  </h3>
                  {detailVoluntaryWork.length === 0 ? (
                    <EmptyRows message="No voluntary-work rows recorded." />
                  ) : (
                    <div className="grid gap-4">
                      {detailVoluntaryWork.map((row, index) => (
                        <div
                          key={row.id ?? `voluntary-${index}`}
                          className="grid gap-4 rounded-[3px] border border-line bg-[#fafbfd] p-4"
                        >
                          <strong className="text-xs font-[680] text-ink">
                            Voluntary work {index + 1}
                          </strong>
                          <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                            <DetailValue
                              label="Organization name and address"
                              value={row.organizationNameAddress}
                            />
                            <DetailValue
                              label="Inclusive dates"
                              value={sequenceLabel(
                                stringValue(row.inclusiveFrom),
                                stringValue(row.inclusiveTo),
                              )}
                            />
                            <DetailValue label="Number of hours" value={row.hours} />
                            <DetailValue
                              label="Position / nature of work"
                              value={row.positionNatureOfWork}
                            />
                            <DetailValue label="Evidence document ID" value={row.documentId} />
                            <DetailValue
                              label="Evidence document version ID"
                              value={row.documentVersionId}
                            />
                          </dl>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid gap-4">
                  <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                    Learning and development
                  </h3>
                  {detailLearningAndDevelopment.length === 0 ? (
                    <EmptyRows message="No learning-and-development rows recorded." />
                  ) : (
                    <div className="grid gap-4">
                      {detailLearningAndDevelopment.map((row, index) => (
                        <div
                          key={row.id ?? `learning-${index}`}
                          className="grid gap-4 rounded-[3px] border border-line bg-[#fafbfd] p-4"
                        >
                          <strong className="text-xs font-[680] text-ink">
                            Learning and development {index + 1}
                          </strong>
                          <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                            <DetailValue
                              label="Intervention / training title"
                              value={row.interventionTitle}
                            />
                            <DetailValue
                              label="Attendance dates"
                              value={sequenceLabel(
                                stringValue(row.attendanceFrom),
                                stringValue(row.attendanceTo),
                              )}
                            />
                            <DetailValue label="Number of hours" value={row.hours} />
                            <DetailValue label="Type" value={row.type} />
                            <DetailValue
                              label="Conducted / sponsored by"
                              value={row.conductedSponsoredBy}
                            />
                            <DetailValue label="Evidence document ID" value={row.documentId} />
                            <DetailValue
                              label="Evidence document version ID"
                              value={row.documentVersionId}
                            />
                          </dl>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid gap-4">
                  <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                    Work Experience Sheet
                  </h3>
                  {detailWes.length === 0 ? (
                    <EmptyRows message="No Work Experience Sheet artifacts recorded." />
                  ) : (
                    <div className="grid gap-4">
                      {detailWes.map((artifact, artifactIndex) => (
                        <div
                          key={artifact.id ?? `wes-${artifactIndex}`}
                          className="grid gap-4 rounded-[3px] border border-line bg-[#fafbfd] p-4"
                        >
                          <strong className="text-xs font-[680] text-ink">
                            WES artifact {artifactIndex + 1}
                          </strong>
                          <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                            <DetailValue label="Context key" value={artifact.contextKey} />
                            <DetailValue label="Evidence document ID" value={artifact.documentId} />
                            <DetailValue
                              label="Evidence document version ID"
                              value={artifact.documentVersionId}
                            />
                          </dl>
                          <div className="grid gap-4">
                            {artifact.entries.map((entry, entryIndex) => {
                              const parent = detailWorkExperience.find(
                                (row) =>
                                  (entry.workExperienceId && row.id === entry.workExperienceId) ||
                                  (!entry.workExperienceId &&
                                    entry.workExperienceSequenceNo === row.sequenceNo),
                              );
                              return (
                                <div
                                  key={entry.id ?? `wes-entry-${entryIndex}`}
                                  className="grid gap-4 rounded-[3px] border border-line bg-paper p-4"
                                >
                                  <strong className="text-xs font-[680] text-ink">
                                    WES entry {entryIndex + 1}
                                  </strong>
                                  <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                                    <DetailValue
                                      label="Parent work row"
                                      value={
                                        parent
                                          ? [
                                              parent.positionTitle,
                                              parent.departmentAgencyOfficeCompany,
                                            ]
                                              .filter(Boolean)
                                              .join(' · ') || `Work experience ${parent.sequenceNo}`
                                          : (entry.workExperienceId ??
                                            entry.workExperienceSequenceNo)
                                      }
                                    />
                                    <DetailValue label="Duration text" value={entry.durationText} />
                                    <DetailValue label="Position" value={entry.position} />
                                    <DetailValue label="Office / unit" value={entry.officeUnit} />
                                    <DetailValue
                                      label="Immediate supervisor"
                                      value={entry.immediateSupervisor}
                                    />
                                    <DetailValue
                                      label="Agency / organization / location"
                                      value={entry.agencyOrganizationLocation}
                                    />
                                    <DetailValue
                                      label="Accomplishments / contributions"
                                      value={entry.accomplishments}
                                    />
                                    <DetailValue
                                      label="Summary of actual duties"
                                      value={entry.actualDuties}
                                    />
                                  </dl>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid gap-4">
                  <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                    Item 26 · Education
                  </h3>
                  {education.length ? (
                    <div className="grid gap-3">
                      {education.map((record, index) => (
                        <dl
                          key={record.id ?? index}
                          className="grid gap-x-8 gap-y-5 rounded-[3px] border border-line bg-[#fafbfd] p-4 min-[620px]:grid-cols-3"
                        >
                          <DetailValue label="Level" value={record.level} />
                          <DetailValue label="School" value={record.schoolName} />
                          <DetailValue label="Degree / course" value={record.degreeCourse} />
                          <DetailValue
                            label="Period of attendance"
                            value={record.periodOfAttendance}
                          />
                          <DetailValue
                            label="Highest level / units"
                            value={record.highestLevelUnits}
                          />
                          <DetailValue label="Year graduated" value={record.yearGraduated} />
                          <DetailValue label="Honors" value={record.honors} />
                          <DetailValue label="Document ID" value={record.documentId} />
                          <DetailValue
                            label="Document version ID"
                            value={record.documentVersionId}
                          />
                        </dl>
                      ))}
                    </div>
                  ) : (
                    <p className="m-0 text-sm text-muted">No education rows recorded.</p>
                  )}
                </div>
                <div className="grid gap-4">
                  <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                    Item 27 · Eligibility
                  </h3>
                  {eligibility.length ? (
                    <div className="grid gap-3">
                      {eligibility.map((record, index) => (
                        <dl
                          key={record.id ?? index}
                          className="grid gap-x-8 gap-y-5 rounded-[3px] border border-line bg-[#fafbfd] p-4 min-[620px]:grid-cols-3"
                        >
                          <DetailValue
                            label="Eligibility / category"
                            value={record.eligibilityName}
                          />
                          <DetailValue label="Rating" value={record.rating} />
                          <DetailValue
                            label="Exam / conferment date"
                            value={record.examDate ? formatEmployeeDate(record.examDate) : null}
                          />
                          <DetailValue label="Exam / conferment place" value={record.examPlace} />
                          <DetailValue label="License number" value={record.licenseNo} />
                          <DetailValue
                            label="Valid until"
                            value={record.validUntil ? formatEmployeeDate(record.validUntil) : null}
                          />
                          <DetailValue label="Document ID" value={record.documentId} />
                          <DetailValue
                            label="Document version ID"
                            value={record.documentVersionId}
                          />
                        </dl>
                      ))}
                    </div>
                  ) : (
                    <p className="m-0 text-sm text-muted">No eligibility rows recorded.</p>
                  )}
                </div>
              </div>
            )}
          </section>

          <section
            className="rounded-[5px] border border-line bg-paper"
            aria-labelledby="pds-history-heading"
          >
            <header className="flex min-h-[58px] items-center border-b border-line px-5">
              <div>
                <p className="m-0 font-mono text-[10px] font-bold tracking-[.1em] text-cobalt">
                  RECORD HISTORY
                </p>
                <h2 id="pds-history-heading" className="mt-1 mb-0 text-sm font-[680] text-midnight">
                  Versions
                </h2>
              </div>
            </header>
            {list.versions.length === 0 ? (
              <p className="m-0 px-5 py-6 text-sm text-muted">No versions recorded.</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {list.versions.map((version) => (
                  <li
                    key={version.id}
                    className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 last:border-b-0"
                  >
                    <div className="grid gap-1">
                      <button
                        type="button"
                        className="text-left font-mono text-xs text-cobalt underline"
                        onClick={() => navigation.navigate({ pdsVersion: version.id })}
                      >
                        v{version.versionNo}
                      </button>
                      <span className="text-xs text-muted">
                        As of {formatEmployeeDate(version.asOfDate)}
                      </span>
                    </div>
                    <StatusBadge status={version.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
