import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PersonnelSalaryFactsModule } from '../personnel-salary-facts/personnel-salary-facts.module';
import { CompensationBasisController } from './compensation-basis.controller';
import { CompensationBasisService } from './compensation-basis.service';

@Module({
  imports: [AuthModule, PersonnelSalaryFactsModule],
  controllers: [CompensationBasisController],
  providers: [CompensationBasisService],
  exports: [CompensationBasisService],
})
export class CompensationBasisModule {}
