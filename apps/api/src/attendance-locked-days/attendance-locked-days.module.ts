import { Module } from '@nestjs/common';
import { AttendanceLockedDaysService } from './attendance-locked-days.service';

@Module({
  providers: [AttendanceLockedDaysService],
  exports: [AttendanceLockedDaysService],
})
export class AttendanceLockedDaysModule {}
