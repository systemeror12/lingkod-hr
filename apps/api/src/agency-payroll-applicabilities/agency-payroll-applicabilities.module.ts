import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { AgencyPayrollApplicabilitiesController } from './agency-payroll-applicabilities.controller';
import { EndAgencyPayrollApplicabilityService } from './end-agency-payroll-applicability.service';
import { RecordAgencyPayrollApplicabilityService } from './record-agency-payroll-applicability.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [AgencyPayrollApplicabilitiesController],
  providers: [RecordAgencyPayrollApplicabilityService, EndAgencyPayrollApplicabilityService],
})
export class AgencyPayrollApplicabilitiesModule {}
