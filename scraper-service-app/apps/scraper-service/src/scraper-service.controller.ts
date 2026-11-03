import { Controller, Get, Post, Headers, UnauthorizedException, Body } from '@nestjs/common';
import { ScraperServiceService } from './scraper-service.service';

@Controller()
export class ScraperServiceController {
  constructor(private readonly scraperServiceService: ScraperServiceService) { }

  @Get('scrape-manual')
  async scrapeManual(): Promise<void> {
    await this.scraperServiceService.scrapeJobListing();
  }

  @Post('scrape')
  async scrapeJobListing(
    @Headers('X-CloudScheduler') schedulerHeader?: string
  ): Promise<{ message: string }> {

    if (!schedulerHeader) {
      throw new UnauthorizedException("Not authorized");
    }

    await this.scraperServiceService.scrapeJobListing();
    return { message: 'Scraping job completed successfully' }
  }

  @Post('get-company-revenue')
  async getCompanyRevenue(@Body() data: { companyName: string }): Promise<string> {
    return await this.scraperServiceService.getCompanyRevenue(data.companyName);
  }

  @Post('get-company-industry-info')
  async getCompanyIndustryInfo(@Body() data: { companyName: string }): Promise<any> {
    return await this.scraperServiceService.getCompanyIndustry(data.companyName);
  }

}
