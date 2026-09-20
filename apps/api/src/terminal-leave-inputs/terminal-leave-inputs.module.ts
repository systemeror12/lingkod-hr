import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { SeparationsModule } from '../separations/separations.module';
import { TerminalLeaveInputsController } from './terminal-leave-inputs.controller';
import {
  TERMINAL_LEAVE_INPUT_AUDIT_WRITER,
  TerminalLeaveInputsService,
  terminalLeaveInputAuditWriter,
} from './terminal-leave-inputs.service';

@Module({
  imports: [AuthModule, DocumentsModule, SeparationsModule],
  controllers: [TerminalLeaveInputsController],
  providers: [
    TerminalLeaveInputsService,
    {
      provide: TERMINAL_LEAVE_INPUT_AUDIT_WRITER,
      useValue: terminalLeaveInputAuditWriter,
    },
  ],
  exports: [TerminalLeaveInputsService],
})
export class TerminalLeaveInputsModule {}
