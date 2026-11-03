import { Controller, Get, Post, Query, Body, Put, ValidationPipe, Req, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import { Job } from './entities/job.entity';
import { CreateJobDto } from './dto/create-job.dto';
import { SearchJobDto } from './dto/search-job.dto';
import { StorageServiceService } from './storage-service.service';

@Controller('jobs')
export class StorageServiceController {
  private readonly logger = new Logger(StorageServiceController.name);

  constructor(private readonly storageService: StorageServiceService) { }

  @Get()
  async search(
    @Query() dataQuery: SearchJobDto): Promise<{ data: Job[], total: number, page: number, limit: number, totalPages: number }> {
    try {
      const { data, total, page, limit, totalPages } = await this.storageService.searchJobs(dataQuery);
      return { data, total, page, limit, totalPages }
    } catch (err) {
      throw err;
    }
  }

  @Post('save')
  async upsertJob(@Body() data: any, @Req() req: any): Promise<{ isNew: boolean }> {
    this.logger.debug('=== INCOMING REQUEST DEBUG ===');
    this.logger.debug('Request method:', req.method);
    this.logger.debug('Request headers:', {
      'content-type': req.headers['content-type'],
      'content-length': req.headers['content-length'],
      'user-agent': req.headers['user-agent']
    });

    this.logger.debug('Raw body received:', data);
    this.logger.debug('Body type:', typeof data);
    this.logger.debug('Body constructor:', data?.constructor?.name);
    this.logger.debug('Body is null:', data === null);
    this.logger.debug('Body is undefined:', data === undefined);

    if (data && typeof data === 'object') {
      this.logger.debug('Body keys:', Object.keys(data));
      this.logger.debug('Body values preview:', {
        title: data.title,
        company: data.company,
        jobUrl: data.jobUrl
      });
    }

    if (!data || Object.keys(data).length === 0) {
      this.logger.error('❌ Received empty or null body!');
      this.logger.debug('Request body raw:', req.body);
      this.logger.debug('Request raw body:', req.rawBody);

      throw new Error('Request body is empty or null');
    }

    this.logger.log('✅ Processing job save request');

    try {
      const result = await this.storageService.upsertJob(data);
      this.logger.log('✅ Successfully saved job');
      return result;
    } catch (error) {
      this.logger.error('❌ Error in upsertJob:', error);
      throw error;
    }
  }

  @Post('/user')
  async getUser(@Body() data: { email: string }) {
    return this.storageService.getUser(data.email);
  }

  @Post('/user/create')
  async createUser(@Body() data: any) {
    try {
      const user = await this.storageService.createUnverifiedUser(data);
      return {
        success: true,
        data: user,
        message: 'User created successfully'
      };
    } catch (err) {
      this.logger.error('Error in createUser controller:', err);
      throw err;
    }
  }

  @Put('/user/reset-password')
  async resetUserPassword(@Body() data: { email: string; password: string }) {
    return this.storageService.resetUserPassword(data.email, data.password);
  }

  @Post('/user/verify-otp')
  async verifyUserOtp(@Body() data: { email: string; otp: string }) {
    return this.storageService.verifyUserWithOtp(data.email, data.otp);
  }

  @Post('/user/update-otp')
  async updateUserOtp(@Body() data: { id: string; otp: string; expiry: Date }) {
    return this.storageService.updateUserOtp(data.id, data.otp, data.expiry);
  }

  @Post('/searches')
  async saveSearches(@Body() data: any) {
    return this.storageService.saveSearches(data);
  }

  @Get('/searches')
  async fetchUserSearches(@Query('userId') userId: string) {
    return this.storageService.fetchUserSearches(userId);
  }

  @Put('/searches/alert')
  async updateSearchAlert(@Body() data: { id: number; alert: boolean }) {
    return this.storageService.updateSearchAlert(data.id, data.alert);
  }

  @Get('/new')
  async fetchNewJobs() {
    return this.storageService.getAllNewJobs();
  }

  @Post('/cleanup')
  async cleanupOldJobs(@Query('days') days?: string) {
    this.logger.log(`Cleanup endpoint called with retention days: ${days || 'default'}`);

    try {
      const retentionDays = days ? parseInt(days, 10) : 60;

      if (isNaN(retentionDays) || retentionDays < 1) {
        this.logger.error(`Invalid retention days parameter: ${days}`);
        return {
          success: false,
          error: 'Invalid retention days parameter. Must be a positive number.',
        };
      }

      const result = await this.storageService.deleteJobsOlderThan(retentionDays);

      this.logger.log(`Cleanup completed successfully: ${result.deletedCount} jobs deleted`);

      return {
        success: true,
        ...result
      };
    } catch (error) {
      this.logger.error('Error during cleanup:', error);
      this.logger.error('Error stack trace:', error.stack);

      return {
        success: false,
        error: error.message,
      };
    }
  }
}