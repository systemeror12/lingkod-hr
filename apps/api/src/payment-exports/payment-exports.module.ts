import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentExportsController } from './payment-exports.controller';
import { PaymentExportsService } from './payment-exports.service';

@Module({
  imports: [AuthModule],
  controllers: [PaymentExportsController],
  providers: [PaymentExportsService],
})
export class PaymentExportsModule {}
