import { Module } from '@nestjs/common';
import { AttendanceDaysModule } from '../attendance-days/attendance-days.module';
import { AttendanceCtoInputsService } from './attendance-cto-inputs.service';

@Module({
  imports: [AttendanceDaysModule],
  providers: [AttendanceCtoInputsService],
  exports: [AttendanceCtoInputsService],
})
export class AttendanceCtoInputsModule {}
