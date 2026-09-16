import type {
  LeaveCatalogueEntrySummary,
  LeaveConfigurationAssessment,
  LeaveHistoryEntry,
  LeavePolicyAuthoritySummary,
  LeavePolicyVersionSummary,
  LeaveTypeDetail,
  LeaveTypeSummary,
} from './leave-policies.service';
import { LEAVE_EVIDENCE_KINDS, LEAVE_PERSONNEL_PROFILES } from './leave-catalogue';

export class LeaveCatalogueEntryDto {
  readonly code: string;
  readonly name: string;
  readonly evaluatorKind: LeaveCatalogueEntrySummary['evaluatorKind'];
  readonly entitlementBasis: LeaveCatalogueEntrySummary['entitlementBasis'];
  readonly calendarBasis: LeaveCatalogueEntrySummary['calendarBasis'];
  readonly chargedLeaveTypeCode: string | null;
  readonly activationPolicy: LeaveCatalogueEntrySummary['activationPolicy'];
  readonly personnelProfiles: readonly string[];
  readonly requiredEvidenceKinds: readonly string[];
  readonly ruleParameters: unknown;
  readonly authorityCitations: LeaveCatalogueEntrySummary['authorityCitations'];
  readonly failClosed: boolean;

  constructor(entry: LeaveCatalogueEntrySummary) {
    this.code = entry.code;
    this.name = entry.name;
    this.evaluatorKind = entry.evaluatorKind;
    this.entitlementBasis = entry.entitlementBasis;
    this.calendarBasis = entry.calendarBasis;
    this.chargedLeaveTypeCode = entry.chargedLeaveTypeCode;
    this.activationPolicy = entry.activationPolicy;
    this.personnelProfiles = entry.personnelProfiles;
    this.requiredEvidenceKinds = entry.requiredEvidenceKinds;
    this.ruleParameters = entry.ruleParameters;
    this.authorityCitations = entry.authorityCitations;
    this.failClosed = entry.failClosed;
  }
}

export class LeaveCatalogueResponseDto {
  readonly entries: LeaveCatalogueEntryDto[];
  readonly personnelProfiles: readonly string[];
  readonly evidenceKinds: readonly string[];

  constructor(entries: LeaveCatalogueEntrySummary[]) {
    this.entries = entries.map((entry) => new LeaveCatalogueEntryDto(entry));
    this.personnelProfiles = LEAVE_PERSONNEL_PROFILES;
    this.evidenceKinds = LEAVE_EVIDENCE_KINDS;
  }
}

export class LeavePolicyAuthorityDto {
  readonly id: string;
  readonly authorityClass: LeavePolicyAuthoritySummary['authorityClass'];
  readonly documentId: string;
  readonly documentNo: string | null;
  readonly documentType: string;
  readonly classification: string;
  readonly documentStatus: string;
  readonly documentVersionId: string;
  readonly documentVersionNo: number;
  readonly citation: string;
  readonly validationReason: string | null;
  readonly createdAt: string;

  constructor(authority: LeavePolicyAuthoritySummary) {
    this.id = authority.id;
    this.authorityClass = authority.authorityClass;
    this.documentId = authority.documentId;
    this.documentNo = authority.documentNo;
    this.documentType = authority.documentType;
    this.classification = authority.classification;
    this.documentStatus = authority.documentStatus;
    this.documentVersionId = authority.documentVersionId;
    this.documentVersionNo = authority.documentVersionNo;
    this.citation = authority.citation;
    this.validationReason = authority.validationReason;
    this.createdAt = authority.createdAt;
  }
}

export class LeavePolicyVersionDto {
  readonly id: string;
  readonly leaveTypeId: string;
  readonly versionNo: number;
  readonly entitlementBasis: LeavePolicyVersionSummary['entitlementBasis'];
  readonly calendarBasis: LeavePolicyVersionSummary['calendarBasis'];
  readonly chargedLeaveTypeId: string | null;
  readonly chargedLeaveTypeCode: string | null;
  readonly evaluatorKind: LeavePolicyVersionSummary['evaluatorKind'];
  readonly ruleParameters: unknown;
  readonly applicability: LeavePolicyVersionSummary['applicability'];
  readonly documentRequirements: LeavePolicyVersionSummary['documentRequirements'];
  readonly approvalRouteCode: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: LeavePolicyVersionSummary['status'];
  readonly authorities: LeavePolicyAuthorityDto[];
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(version: LeavePolicyVersionSummary) {
    this.id = version.id;
    this.leaveTypeId = version.leaveTypeId;
    this.versionNo = version.versionNo;
    this.entitlementBasis = version.entitlementBasis;
    this.calendarBasis = version.calendarBasis;
    this.chargedLeaveTypeId = version.chargedLeaveTypeId;
    this.chargedLeaveTypeCode = version.chargedLeaveTypeCode;
    this.evaluatorKind = version.evaluatorKind;
    this.ruleParameters = version.ruleParameters;
    this.applicability = version.applicability;
    this.documentRequirements = version.documentRequirements;
    this.approvalRouteCode = version.approvalRouteCode;
    this.effectiveFrom = version.effectiveFrom;
    this.effectiveTo = version.effectiveTo;
    this.status = version.status;
    this.authorities = version.authorities.map(
      (authority) => new LeavePolicyAuthorityDto(authority),
    );
    this.rowVersion = version.rowVersion;
    this.createdAt = version.createdAt;
    this.updatedAt = version.updatedAt;
  }
}

export class LeaveTypeDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: LeaveTypeSummary['status'];
  readonly catalogue: LeaveCatalogueEntryDto;
  readonly currentVersion: LeavePolicyVersionDto | null;
  readonly draft: LeavePolicyVersionDto | null;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(leaveType: LeaveTypeSummary) {
    this.id = leaveType.id;
    this.code = leaveType.code;
    this.name = leaveType.name;
    this.status = leaveType.status;
    this.catalogue = new LeaveCatalogueEntryDto(leaveType.catalogue);
    this.currentVersion = leaveType.currentVersion
      ? new LeavePolicyVersionDto(leaveType.currentVersion)
      : null;
    this.draft = leaveType.draft ? new LeavePolicyVersionDto(leaveType.draft) : null;
    this.createdAt = leaveType.createdAt;
    this.updatedAt = leaveType.updatedAt;
  }
}

export class LeaveTypeListResponseDto {
  readonly leaveTypes: LeaveTypeDto[];

  constructor(leaveTypes: LeaveTypeSummary[]) {
    this.leaveTypes = leaveTypes.map((leaveType) => new LeaveTypeDto(leaveType));
  }
}

export class LeaveConfigurationDto {
  readonly result: LeaveConfigurationAssessment['result'];
  readonly reasons: string[];

  constructor(configuration: LeaveConfigurationAssessment) {
    this.result = configuration.result;
    this.reasons = configuration.reasons;
  }
}

export class LeaveHistoryEntryDto {
  readonly id: string;
  readonly action: string;
  readonly previousStatus: string | null;
  readonly newStatus: string | null;
  readonly reason: string | null;
  readonly effectiveDate: string | null;
  readonly occurredAt: string;

  constructor(entry: LeaveHistoryEntry) {
    this.id = entry.id;
    this.action = entry.action;
    this.previousStatus = entry.previousStatus;
    this.newStatus = entry.newStatus;
    this.reason = entry.reason;
    this.effectiveDate = entry.effectiveDate;
    this.occurredAt = entry.occurredAt;
  }
}

export class LeaveTypeDetailDto {
  readonly leaveType: LeaveTypeDto;
  readonly asOf: string;
  readonly effective: LeavePolicyVersionDto | null;
  readonly configuration: LeaveConfigurationDto;
  readonly versions: LeavePolicyVersionDto[];
  readonly history: LeaveHistoryEntryDto[];

  constructor(detail: LeaveTypeDetail) {
    this.leaveType = new LeaveTypeDto(detail.leaveType);
    this.asOf = detail.asOf;
    this.effective = detail.effective ? new LeavePolicyVersionDto(detail.effective) : null;
    this.configuration = new LeaveConfigurationDto(detail.configuration);
    this.versions = detail.versions.map((version) => new LeavePolicyVersionDto(version));
    this.history = detail.history.map((entry) => new LeaveHistoryEntryDto(entry));
  }
}
