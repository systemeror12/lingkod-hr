import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { AccountingSupportExportsController } from './accounting-support-exports.controller';
import { AccountingSupportExportsService } from './accounting-support-exports.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [AccountingSupportExportsController],
  providers: [AccountingSupportExportsService],
})
export class AccountingSupportExportsModule {}
