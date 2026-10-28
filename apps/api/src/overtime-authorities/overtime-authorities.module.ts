import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CancelOvertimeAuthorityService } from './cancel-overtime-authority.service';
import { CreateOvertimeAuthorityService } from './create-overtime-authority.service';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  overtimeAuthorityAuditWriter,
} from './overtime-authorities.audit';
import { OvertimeAuthoritiesController } from './overtime-authorities.controller';
import { SubmitOvertimeAuthorityService } from './submit-overtime-authority.service';
import { UpdateOvertimeAuthorityService } from './update-overtime-authority.service';

@Module({
  imports: [AuthModule],
  controllers: [OvertimeAuthoritiesController],
  providers: [
    CreateOvertimeAuthorityService,
    UpdateOvertimeAuthorityService,
    SubmitOvertimeAuthorityService,
    CancelOvertimeAuthorityService,
    { provide: OVERTIME_AUTHORITY_AUDIT_WRITER, useValue: overtimeAuthorityAuditWriter },
  ],
})
export class OvertimeAuthoritiesModule {}
