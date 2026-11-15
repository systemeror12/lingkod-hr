import { Module } from '@nestjs/common';
import { PersonnelSalaryFactsService } from './personnel-salary-facts.service';

@Module({
  providers: [PersonnelSalaryFactsService],
  exports: [PersonnelSalaryFactsService],
})
export class PersonnelSalaryFactsModule {}
