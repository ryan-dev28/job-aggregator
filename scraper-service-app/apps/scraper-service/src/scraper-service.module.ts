import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { ScraperServiceController } from './scraper-service.controller';
import { ScraperServiceService } from './scraper-service.service';
import { CompanyIndustryService } from './company-industry.service';

@Module({
  imports: [ScheduleModule.forRoot(), HttpModule, ConfigModule.forRoot({
    isGlobal: true,
  }),],
  controllers: [ScraperServiceController],
  providers: [ScraperServiceService, CompanyIndustryService],
})
export class ScraperServiceModule { }
