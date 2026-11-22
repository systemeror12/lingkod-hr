import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AgencyProfileModule } from './agency-profile/agency-profile.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { OrganizationModule } from './organization/organization.module';
import { DocumentsModule } from './documents/documents.module';
import { StaffingAuthoritiesModule } from './staffing-authorities/staffing-authorities.module';
import { QualificationStandardsModule } from './qualification-standards/qualification-standards.module';
import { PlantillaPositionsModule } from './plantilla-positions/plantilla-positions.module';
import { EmployeesModule } from './employees/employees.module';
import { PdsModule } from './pds/pds.module';
import { EmployeeDocumentsModule } from './employee-documents/employee-documents.module';
import { PersonnelBaselinesModule } from './personnel-baselines/personnel-baselines.module';
import { GovernmentIdentifiersModule } from './government-identifiers/government-identifiers.module';
import { PersonnelActionsModule } from './personnel-actions/personnel-actions.module';
import { PayrollBankAccountsModule } from './payroll-bank-accounts/payroll-bank-accounts.module';
import { PayrollInputsModule } from './payroll-inputs/payroll-inputs.module';
import { DeductionObligationsModule } from './deduction-obligations/deduction-obligations.module';
import { ContributionBillingsModule } from './contribution-billings/contribution-billings.module';
import { PayrollPeriodsModule } from './payroll-periods/payroll-periods.module';
import { PayrollCalculationModule } from './payroll-calculation/payroll-calculation.module';
import { PayslipsModule } from './payslips/payslips.module';
import { PayrollRegistersModule } from './payroll-registers/payroll-registers.module';
import { LegacyRegisterComparisonsModule } from './legacy-register-comparisons/legacy-register-comparisons.module';
import { PayrollExceptionsModule } from './payroll-exceptions/payroll-exceptions.module';
import { PayrollResultsModule } from './payroll-results/payroll-results.module';
import { PaymentExportsModule } from './payment-exports/payment-exports.module';
import { AccountingSupportExportsModule } from './accounting-support-exports/accounting-support-exports.module';
import { ContributionRemittancesModule } from './contribution-remittances/contribution-remittances.module';
import { DeductionSummariesModule } from './deduction-summaries/deduction-summaries.module';
import { PayrollVarianceReportsModule } from './payroll-variance-reports/payroll-variance-reports.module';
import { AuthorizedPayrollComponentInputsModule } from './authorized-payroll-component-inputs/authorized-payroll-component-inputs.module';
import { AgencyPayrollApplicabilitiesModule } from './agency-payroll-applicabilities/agency-payroll-applicabilities.module';
import { CompensationBasisModule } from './compensation-basis/compensation-basis.module';
import { NationalPayrollRuleVersionsModule } from './payroll-rule-versions/national-payroll-rule-versions.module';
import { SalnComplianceModule } from './saln-compliance/saln-compliance.module';
import { ServiceRecordsModule } from './service-records/service-records.module';
import { ApprovalModule } from './approvals/approval.module';
import { RecruitmentModule } from './recruitment/recruitment.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { AttendanceConfigurationModule } from './attendance-configuration/attendance-configuration.module';
import { AttendanceContextsModule } from './attendance-contexts/attendance-contexts.module';
import { AttendanceDaysModule } from './attendance-days/attendance-days.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AttendanceCorrectionsModule } from './attendance-corrections/attendance-corrections.module';
import { AttendanceSubmissionsModule } from './attendance-submissions/attendance-submissions.module';
import { AttendancePeriodsModule } from './attendance-periods/attendance-periods.module';
import { DtrsModule } from './dtrs/dtrs.module';
import { LeavePoliciesModule } from './leave-policies/leave-policies.module';
import { LeaveAccountsModule } from './leave-accounts/leave-accounts.module';
import { MandatoryLeaveAssessmentsModule } from './mandatory-leave-assessments/mandatory-leave-assessments.module';
import { LeaveApplicationsModule } from './leave-applications/leave-applications.module';
import { LeaveMonetizationModule } from './leave-monetization/leave-monetization.module';
import { TerminalLeaveInputsModule } from './terminal-leave-inputs/terminal-leave-inputs.module';
import { OvertimeAuthoritiesModule } from './overtime-authorities/overtime-authorities.module';
import { CocAccountsModule } from './coc-accounts/coc-accounts.module';
import { OvertimeServiceRecordsModule } from './overtime-service-records/overtime-service-records.module';
import { CocEarnedCertificatesModule } from './coc-earned-certificates/coc-earned-certificates.module';
import { CtoRequestsModule } from './cto-requests/cto-requests.module';
import { AttendanceDeficitChargesModule } from './attendance-deficit-charges/attendance-deficit-charges.module';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    AgencyProfileModule,
    OrganizationModule,
    DocumentsModule,
    StaffingAuthoritiesModule,
    QualificationStandardsModule,
    PlantillaPositionsModule,
    EmployeesModule,
    PdsModule,
    EmployeeDocumentsModule,
    PersonnelBaselinesModule,
    GovernmentIdentifiersModule,
    PersonnelActionsModule,
    PayrollBankAccountsModule,
    PayrollInputsModule,
    DeductionObligationsModule,
    ContributionBillingsModule,
    PayrollPeriodsModule,
    PayrollCalculationModule,
    PayrollExceptionsModule,
    PayrollResultsModule,
    PayslipsModule,
    PayrollRegistersModule,
    LegacyRegisterComparisonsModule,
    PaymentExportsModule,
    AccountingSupportExportsModule,
    ContributionRemittancesModule,
    DeductionSummariesModule,
    PayrollVarianceReportsModule,
    AuthorizedPayrollComponentInputsModule,
    AgencyPayrollApplicabilitiesModule,
    CompensationBasisModule,
    NationalPayrollRuleVersionsModule,
    SalnComplianceModule,
    ServiceRecordsModule,
    ApprovalModule,
    RecruitmentModule,
    AppointmentsModule,
    AttendanceConfigurationModule,
    AttendanceContextsModule,
    AttendanceDaysModule,
    AttendanceModule,
    AttendanceCorrectionsModule,
    AttendanceSubmissionsModule,
    AttendancePeriodsModule,
    DtrsModule,
    LeavePoliciesModule,
    LeaveAccountsModule,
    MandatoryLeaveAssessmentsModule,
    LeaveApplicationsModule,
    LeaveMonetizationModule,
    TerminalLeaveInputsModule,
    OvertimeAuthoritiesModule,
    CocAccountsModule,
    OvertimeServiceRecordsModule,
    CocEarnedCertificatesModule,
    CtoRequestsModule,
    AttendanceDeficitChargesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
