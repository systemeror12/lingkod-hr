import { Module } from '@nestjs/common';
import { AttendancePostedLeaveInputsService } from './attendance-posted-leave-inputs.service';

@Module({
  providers: [AttendancePostedLeaveInputsService],
  exports: [AttendancePostedLeaveInputsService],
})
export class AttendancePostedLeaveInputsModule {}
