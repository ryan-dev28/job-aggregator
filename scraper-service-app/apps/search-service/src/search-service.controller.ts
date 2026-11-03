import { Controller, Get, Query, Put, Post, Body, Logger, Param } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';

import { CreateSearchesDTO } from 'libs/common/src/dto/create-searches.dto';
import { SearchServiceService } from './search-service.service';

@Controller('jobs')
export class SearchServiceController {
  private logger: Logger = new Logger(SearchServiceController.name)
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly searchService: SearchServiceService,
  ) { }

  private get storageHost() {
    return this.configService.get<string>('STORAGE_SERVICE_HOST');
  }

  @Get()
  async search(
    @Query('page') pageQuery: number,
    @Query('limit') limitQuery: number,
    @Query('search') search: string,
    @Query('company') company: string,
    @Query('title') title: string,
    @Query('keyword') keyword: string,
    @Query('datePosted') datePosted: string,
    @Query('location') locations: string | string[],
    @Query('sort') sort: string,
    @Query('revenue') revenue: string[],
    @Query('industry') industry: string | string[],
  ): Promise<{ data: any[], total: number, page: number, limit: number, totalPages: number }> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(
          `${this.storageHost}/jobs`,
          {
            params: {
              page: pageQuery,
              limit: limitQuery,
              search,
              company,
              title,
              keyword,
              location: Array.isArray(locations) ? locations.join('|') : locations,
              datePosted,
              sort,
              revenue: revenue && revenue.length > 0 ? revenue[0] : '',
              industry: Array.isArray(industry) ? industry.join('|') : industry
            }
          }
        )
      )

      const { data: results, total, page, limit, totalPages } = data;

      return { data, total, page, limit, totalPages }
    } catch (err) {
      this.logger.error(`Error calling ${this.storageHost}/jobs`, err);
      throw err;
    }
  }

  @Post('save-searches')
  async saveSearches(
    @Body() saveSearchesDTO: CreateSearchesDTO,
  ) {
    try {
      await firstValueFrom(
        this.httpService.post(`${this.storageHost}/jobs/searches`, saveSearchesDTO),
      );
      return {
        message: 'Search saved successfully',
      };
    } catch (err) {
      this.logger.error(`Error calling ${this.storageHost}/jobs/searches`, err);
      throw err;
    }
  }

  @Get('fetch-user-searches/:userId')
  async fetchUserSearches(
    @Param('userId') userId: string,
  ) {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(`${this.storageHost}/jobs/searches`, {
          params: { userId },
        }),
      );

      return {
        data,
        message: 'User searches fetched successfully',
      };
    } catch (err) {
      this.logger.error(`Error calling ${this.storageHost}/jobs/searches`, err);
      throw err;
    }
  }

  @Put('update-search-alert')
  async updateSearchAlert(
    @Body() data: { id: number; alert: boolean },
  ) {
    try {
      const { data: response } = await firstValueFrom(
        this.httpService.put(`${this.storageHost}/jobs/searches/alert`, data),
      );

      return {
        data: response,
        message: 'Search alert updated successfully',
      };
    } catch (err) {
      this.logger.error(`Error calling ${this.storageHost}/jobs/searches/alert`, err);
      throw err;
    }
  }

  @Post('process-new-jobs-alert')
  async processNewJobsAlert() {
    try {
      const { data: response } = await firstValueFrom(
        this.httpService.get(`${this.storageHost}/jobs/new`),
      );

      this.logger.log(`Processing new jobs alert with ${response.length} jobs`);

      if (response.length > 0) {
        await this.searchService.processAlert(response);
      }

      return {
        data: response,
        message: 'New jobs alert processed successfully',
      };
    } catch (err) {
      this.logger.error(`Error calling ${this.storageHost}/jobs/searches/alert`, err);
      throw err;
    }
  }
}
