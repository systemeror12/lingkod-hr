import { Module } from '@nestjs/common';
import { AttendanceLockedDaysModule } from '../attendance-locked-days/attendance-locked-days.module';
import { AuthModule } from '../auth/auth.module';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  overtimeAuthorityAuditWriter,
} from '../overtime-authorities/overtime-authorities.audit';
import { OvertimeServiceRecordsController } from './overtime-service-records.controller';
import { OvertimeServiceRecordsService } from './overtime-service-records.service';

@Module({
  imports: [AuthModule, AttendanceLockedDaysModule],
  controllers: [OvertimeServiceRecordsController],
  providers: [
    OvertimeServiceRecordsService,
    { provide: OVERTIME_AUTHORITY_AUDIT_WRITER, useValue: overtimeAuthorityAuditWriter },
  ],
})
export class OvertimeServiceRecordsModule {}
