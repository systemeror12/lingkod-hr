import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approvals/approval.module';
import { AuthModule } from '../auth/auth.module';
import { DtrsModule } from '../dtrs/dtrs.module';
import {
  ATTENDANCE_PERIOD_AUDIT_WRITER,
  attendancePeriodAuditWriter,
} from './attendance-periods.audit';
import { AttendancePeriodsController } from './attendance-periods.controller';
import { AttendancePeriodsService } from './attendance-periods.service';

@Module({
  imports: [AuthModule, ApprovalModule, DtrsModule],
  controllers: [AttendancePeriodsController],
  providers: [
    AttendancePeriodsService,
    { provide: ATTENDANCE_PERIOD_AUDIT_WRITER, useValue: attendancePeriodAuditWriter },
  ],
  exports: [AttendancePeriodsService],
})
export class AttendancePeriodsModule {}
