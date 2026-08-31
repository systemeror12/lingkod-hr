import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PdsController } from './pds.controller';
import { PDS_AUDIT_WRITER, pdsAuditWriter, PdsService } from './pds.service';

@Module({
  imports: [AuthModule],
  controllers: [PdsController],
  providers: [PdsService, { provide: PDS_AUDIT_WRITER, useValue: pdsAuditWriter }],
  exports: [PdsService],
})
export class PdsModule {}
