import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GovernmentIdentifiersController } from './government-identifiers.controller';
import {
  GOVERNMENT_IDENTIFIER_AUDIT_WRITER,
  governmentIdentifierAuditWriter,
  GovernmentIdentifiersService,
} from './government-identifiers.service';

@Module({
  imports: [AuthModule],
  controllers: [GovernmentIdentifiersController],
  providers: [
    GovernmentIdentifiersService,
    { provide: GOVERNMENT_IDENTIFIER_AUDIT_WRITER, useValue: governmentIdentifierAuditWriter },
  ],
  exports: [GovernmentIdentifiersService],
})
export class GovernmentIdentifiersModule {}
