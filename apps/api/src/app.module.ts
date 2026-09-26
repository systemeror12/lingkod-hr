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
import { DtrsModule } from './dtrs/dtrs.module';
import { LeavePoliciesModule } from './leave-policies/leave-policies.module';
import { LeaveAccountsModule } from './leave-accounts/leave-accounts.module';
import { LeaveApplicationsModule } from './leave-applications/leave-applications.module';
import { LeaveMonetizationModule } from './leave-monetization/leave-monetization.module';
import { TerminalLeaveInputsModule } from './terminal-leave-inputs/terminal-leave-inputs.module';

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
    DtrsModule,
    LeavePoliciesModule,
    LeaveAccountsModule,
    LeaveApplicationsModule,
    LeaveMonetizationModule,
    TerminalLeaveInputsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
