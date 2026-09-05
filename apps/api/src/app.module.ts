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
  ],
  controllers: [HealthController],
})
export class AppModule {}
