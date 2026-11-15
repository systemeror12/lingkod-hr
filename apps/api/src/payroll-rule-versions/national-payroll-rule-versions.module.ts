import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NationalPayrollRuleVersionsController } from './national-payroll-rule-versions.controller';
import { ReadNationalPayrollRuleVersionsService } from './read-national-payroll-rule-versions.service';

@Module({
  imports: [AuthModule],
  controllers: [NationalPayrollRuleVersionsController],
  providers: [ReadNationalPayrollRuleVersionsService],
})
export class NationalPayrollRuleVersionsModule {}
