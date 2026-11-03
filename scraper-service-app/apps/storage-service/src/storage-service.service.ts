import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { createHash } from 'crypto';

import { Job } from './entities/job.entity';
import { User } from './entities/user.entity';
import { Search } from './entities/search.entity';
import { SearchJobDto } from './dto/search-job.dto';
import { StateMapping } from './utils/constants';
@Injectable()
export class StorageServiceService {
  private readonly logger: Logger = new Logger(StorageServiceService.name);
  private datePostedCache = new Map<string, Date>();
  constructor(
    @InjectRepository(Job)
    private readonly jobRepository: Repository<Job>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Search)
    private readonly searchesRepository: Repository<Search>,
  ) { }

  async upsertJob(jobData: Partial<Job>): Promise<{ isNew: boolean }> {
    try {
      this.logger.log('Saving scraped job....', jobData);

      if (!jobData.title || jobData.title.trim() === '') {
        this.logger.warn('Job title is null/undefined/empty, skipping save.', {
          title: jobData.title,
          company: jobData.company,
          jobUrl: jobData.jobUrl
        });
        return { isNew: false };
      }

      if (!jobData.company || jobData.company.trim() === '') {
        this.logger.warn('Job company is null/undefined/empty, skipping save.', {
          title: jobData.title,
          company: jobData.company,
          jobUrl: jobData.jobUrl
        });
        return { isNew: false };
      }

      if (!jobData.jobUrl || jobData.jobUrl.trim() === '') {
        this.logger.warn('Job URL is null/undefined/empty, skipping save.', {
          title: jobData.title,
          company: jobData.company,
          jobUrl: jobData.jobUrl
        });
        return { isNew: false };
      }

      const cleanJobData = {
        ...jobData,
        title: jobData.title.trim(),
        company: jobData.company.trim(),
        location: jobData.location?.trim() || 'Not specified',
        salary: jobData.salary?.trim() || 'Not specified',
        description: jobData.description?.trim() || 'No description available',
        datePosted: jobData.datePosted?.trim() || 'Unknown',
        revenue: jobData.revenue?.trim() || 'Unknown',
        industry: jobData.industry?.trim() || 'Unknown',
        source: jobData.source?.trim() || 'Unknown'
      };

      const jobSignature = createHash('sha256')
        .update(`${cleanJobData.title}|${cleanJobData.company}|${cleanJobData.location}|${cleanJobData.salary}`)
        .digest('hex');

      const result = await this.jobRepository
        .createQueryBuilder()
        .insert()
        .into(Job)
        .values({
          ...cleanJobData,
          jobSignature,
          searchvector: () => `to_tsvector('english', 
          coalesce('${(cleanJobData.title ?? '').replace(/'/g, "''")}', '') || ' ' || 
          coalesce('${(cleanJobData.company ?? '').replace(/'/g, "''")}', '') || ' ' || 
          substring(coalesce('${(cleanJobData.description ?? '').replace(/'/g, "''")}', ''), 1, 1000) || ' ' ||
          coalesce('${(cleanJobData.salary ?? '')?.replace(/'/g, "''") || ''}', '') || ' ' || 
          coalesce('${(cleanJobData.location ?? '').replace(/'/g, "''")}', '') || ' ' || 
          coalesce('${(cleanJobData.revenue ?? '').replace(/'/g, "''")}', '') || ' ' || 
          coalesce('${(cleanJobData.industry ?? '').replace(/'/g, "''")}', '') || ' ' || 
          coalesce('${(cleanJobData.datePosted ?? '')?.replace(/'/g, "''") || ''}', ''))`
        })
        .orUpdate(
          ['jobUrl', 'salary', 'description', 'source', 'searchvector'],
          ['jobSignature'],
          { skipUpdateIfNoValuesChanged: true }
        )
        .execute();

      this.logger.log(`Successfully saved job: ${cleanJobData.title} at ${cleanJobData.company}`);
      await this.jobRepository.update({ source: "Indeed (Apify)" }, { source: "Indeed" });
      return { isNew: (result.identifiers?.length || 0) > 0 }
    } catch (err) {
      this.logger.error("Error saving scraped job", err);
      this.logger.error("Job data that failed:", jobData);
      throw err;
    }
  }

  async searchJobs(data: SearchJobDto, recent = false): Promise<{ data: Job[], total: number, page: number, limit: number, totalPages: number }> {
    const { search, page, limit, title, keyword, company, location, datePosted, sort = 'newest', revenue, salaryMin, salaryMax, industry } = data;
    console.log('industry', industry);
    try {
      const qb: SelectQueryBuilder<Job> = this.jobRepository.createQueryBuilder('job');
      const pageQuery = page || 1;
      const limitQuery = limit || 10;
      const skip = (pageQuery - 1) * limitQuery;

      if (search) {
        const formattedQuery = search.trim().replace(/\s+/g, ' | ');
        qb.where(`
          job.searchvector @@ to_tsquery('english', :ftsquery)
        `, { ftsquery: formattedQuery });
      }

      if (location) {
        this.applyLocationFilter(qb, location);
      }

      if (title) {
        const titleParam = `%${title.trim()}%`;
        qb.andWhere('job.title ILIKE :title', { title: titleParam });
      }

      if (company) {
        const companyParam = `%${company.trim()}%`;
        qb.andWhere('job.company ILIKE :company', { company: companyParam });
      }

      if (industry) {
        this.applyIndustryFilter(qb, industry);
      }

      if (keyword) {
        const keywordParam = `%${keyword.trim()}%`;
        qb.andWhere('job.description ILIKE :keyword', { keyword: keywordParam });
      }

      if (recent) {
        qb.andWhere('job.createdAt >= CURRENT_DATE');
      }

      if (datePosted) {
        await this.applyDateFilter(qb, datePosted);
      }

      if (revenue) {
        await this.applyRevenueFilter(qb, revenue);
      }

      if (salaryMin || salaryMax) {
        await this.applySalaryRangeFilter(qb, salaryMin, salaryMax);
      }

      const total = await qb.getCount();

      this.applySortingByCreatedAt(qb, sort);

      const jobResults = await qb
        .skip(skip)
        .take(limitQuery)
        .getMany();

      const jobsWithComputedAge = jobResults.map(job => {
        (job as any).originalDatePosted = job.datePosted;
        job.datePosted = this.computeActualAge(job.createdAt);
        return job;
      });

      return {
        data: jobsWithComputedAge,
        total,
        page: pageQuery,
        limit: limitQuery,
        totalPages: Math.ceil(total / limitQuery)
      };
    } catch (err) {
      this.logger.error('Error searching jobs', err);
      throw err;
    }
  }

  private applyLocationFilter(qb: SelectQueryBuilder<Job>, locations: string): void {
    // Split locations by pipe separator for multiple locations
    const locationList = locations.split('|').map(loc => loc.trim()).filter(loc => loc);

    if (locationList.length === 0) return;

    console.log('Searching for locations:', locationList);

    const allConditions: string[] = [];

    locationList.forEach((location, locationIndex) => {
      const stateVariations = StateMapping[location];
      console.log(`Location ${location} variations:`, stateVariations);

      if (stateVariations) {
        const locationConditions: string[] = [];

        stateVariations.forEach((variation, index) => {
          // Check if this is a 2-letter state abbreviation
          if (variation.length === 2 && variation === variation.toUpperCase()) {
            // For 2-letter state codes, be more precise
            const paramComma = `loc${locationIndex}_${index}_comma`;
            qb.setParameter(paramComma, `%, ${variation}`);
            locationConditions.push(`job.location ILIKE :${paramComma}`);

            const paramEnd = `loc${locationIndex}_${index}_end`;
            qb.setParameter(paramEnd, `% ${variation}`);
            locationConditions.push(`job.location ILIKE :${paramEnd}`);

          } else {
            // For full state names or longer abbreviations
            const paramFull = `loc${locationIndex}_${index}_full`;
            qb.setParameter(paramFull, `%${variation}%`);
            locationConditions.push(`job.location ILIKE :${paramFull}`);
          }
        });

        if (locationConditions.length > 0) {
          allConditions.push(`(${locationConditions.join(' OR ')})`);
        }
      } else {
        // Fallback for city names or other location searches
        const paramGeneral = `loc${locationIndex}_general`;
        qb.setParameter(paramGeneral, `%${location}%`);
        allConditions.push(`job.location ILIKE :${paramGeneral}`);
      }
    });

    if (allConditions.length > 0) {
      // Use OR to match any of the selected locations
      qb.andWhere(`(${allConditions.join(' OR ')})`);
      console.log('Applied multi-location filter with', allConditions.length, 'location groups');
    }
  }

  private applySortingByCreatedAt(qb: SelectQueryBuilder<Job>, sort: string): void {
    switch (sort) {
      case 'newest':
        qb.orderBy('job.createdAt', 'DESC');
        break;
      case 'oldest':
        qb.orderBy('job.createdAt', 'ASC');
        break;
      case 'salary-high':
        qb.orderBy(`
        CASE
          WHEN "job"."salary" ~ '^\\$[0-9,]+(/hr)?$' THEN
            CAST(REGEXP_REPLACE("job"."salary", '[^0-9]', '', 'g') AS NUMERIC)
          ELSE 0
        END
      `, 'DESC', 'NULLS LAST');
        break;
      case 'salary-low':
        qb.orderBy(`
        CASE
          WHEN "job"."salary" ~ '^\\$[0-9,]+(/hr)?$' THEN
            CAST(REGEXP_REPLACE("job"."salary", '[^0-9]', '', 'g') AS NUMERIC)
          ELSE 0
        END
      `, 'ASC', 'NULLS LAST');
        break;
      default:
        qb.orderBy('job.createdAt', 'DESC');
    }
  }

  private applyIndustryFilter(qb: SelectQueryBuilder<Job>, industries: string): void {
    const industryList = industries.split('|').map(ind => ind.trim()).filter(ind => ind);

    if (industryList.length === 0) return;

    console.log('Searching for industries:', industryList);

    const industryConditions: string[] = [];

    industryList.forEach((industry, index) => {
      const industryVariations = this.getIndustryVariations(industry);

      industryVariations.forEach((variation, varIndex) => {
        const paramName = `industry${index}_${varIndex}`;
        qb.setParameter(paramName, `%${variation}%`);
        industryConditions.push(`job.industry ILIKE :${paramName}`);
      });
    });

    if (industryConditions.length > 0) {
      qb.andWhere(`(${industryConditions.join(' OR ')})`);
      console.log('Applied industry filter with', industryConditions.length, 'variations');
    }
  }

  private getIndustryVariations(industry: string): string[] {
    const variations = [industry]; // Always include the original

    const industryVariations: Record<string, string[]> = {
      'technology': ['technology', 'information technology', 'software'],
      'healthcare': ['healthcare', 'health care', 'medical'],
      'hospitals and health care': ['hospitals and health care', 'healthcare', 'medical'],
      'finance': ['finance', 'financial services'],
      'banking': ['banking', 'banks', 'financial services'],
      'financial services': ['financial services', 'finance', 'banking'],
      'manufacturing': ['manufacturing', 'industrial'],
      'industrial': ['industrial', 'manufacturing'],
      'retail': ['retail', 'e-commerce'],
      'consulting': ['consulting', 'management consulting'],
      'staffing and recruiting': ['staffing and recruiting', 'staffing', 'recruiting'],
      'business services': ['business services'],
      'professional services': ['professional services'],
      'education': ['education', 'educational services'],
      'training': ['training', 'training services'],
      'real estate': ['real estate', 'property'],
      'automotive': ['automotive', 'auto'],
      'telecommunications': ['telecommunications', 'telecom'],
      'energy': ['energy', 'utilities'],
      'media': ['media', 'entertainment'],
      'construction': ['construction', 'building'],
      'transportation': ['transportation', 'logistics'],
      'biotechnology': ['biotechnology', 'biotech'],
      'pharmaceuticals': ['pharmaceuticals', 'pharma'],
    };

    const lowerIndustry = industry.toLowerCase();

    if (industryVariations[lowerIndustry]) {
      variations.push(...industryVariations[lowerIndustry]);
    }

    return [...new Set(variations)];
  }

  async migrateJobDatePosted(): Promise<{ message: string, updatedCount: number }> {
    try {
      const totalJobs = await this.jobRepository.count();
      await this.updateAllJobDatePosted();

      return {
        message: 'Successfully updated all job datePosted fields',
        updatedCount: totalJobs
      };
    } catch (error) {
      this.logger.error('Migration failed:', error);
      throw new InternalServerErrorException('Failed to migrate job datePosted fields');
    }
  }

  private computeActualAge(createdAt: Date): string {
    const now = new Date();
    const diffInMs = now.getTime() - createdAt.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInMinutes < 1) {
      return 'Just now';
    } else if (diffInMinutes < 60) {
      return `${diffInMinutes}m`;
    } else if (diffInHours < 24) {
      return `${diffInHours}h`;
    } else if (diffInDays < 30) {
      return `${diffInDays}d`;
    } else if (diffInDays < 365) {
      const months = Math.floor(diffInDays / 30);
      return `${months}mo`;
    } else {
      const years = Math.floor(diffInDays / 365);
      return `${years}y`;
    }
  }

  async updateAllJobDatePosted(): Promise<void> {
    try {
      this.logger.log('Starting to update all job datePosted fields...');

      const batchSize = 1000;
      let offset = 0;
      let hasMoreRecords = true;

      while (hasMoreRecords) {
        const jobs = await this.jobRepository.find({
          skip: offset,
          take: batchSize,
          select: ['id', 'createdAt', 'datePosted']
        });

        if (jobs.length === 0) {
          hasMoreRecords = false;
          break;
        }

        const updatePromises = jobs.map(job => {
          const newDatePosted = this.computeActualAge(job.createdAt);
          return this.jobRepository.update(job.id, { datePosted: newDatePosted });
        });

        await Promise.all(updatePromises);

        this.logger.log(`Updated ${jobs.length} jobs (offset: ${offset})`);
        offset += batchSize;
      }

      this.logger.log('Finished updating all job datePosted fields');
    } catch (error) {
      this.logger.error('Error updating job datePosted fields:', error);
      throw error;
    }
  }

  private async applyDateFilter(qb: SelectQueryBuilder<Job>, dateFilter: string): Promise<void> {
    if (!dateFilter.match(/^\d+d$/)) {
      console.warn("Invalid date filter format. Expected format: Xd (e.g., 3d, 7d, 30d)");
      return;
    }

    const daysAgo = parseInt(dateFilter.slice(0, -1));

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);
    startDate.setHours(0, 0, 0, 0);

    const currentDate = new Date();

    qb.andWhere(`
    job.createdAt >= :startDate AND job.createdAt <= :currentDate
  `, {
      startDate: startDate.toISOString(),
      currentDate: currentDate.toISOString()
    });
  }

  private async applyRevenueFilter(qb: SelectQueryBuilder<Job>, revenueRange: string): Promise<void> {
    const ranges = {
      '0-5': { min: 0, max: 5, multiplier: 1000000 },
      '5-20': { min: 5, max: 20, multiplier: 1000000 },
      '20-200': { min: 20, max: 200, multiplier: 1000000 },
      '200+': { min: 200, max: Infinity, multiplier: 1000000 }
    };

    const range = ranges[revenueRange];
    if (!range) return;

    if (range.max === Infinity) {
      qb.andWhere(`
      CASE 
        WHEN job.revenue LIKE '%B' THEN 
          CAST(REGEXP_REPLACE(job.revenue, '[^0-9.]', '', 'g') AS NUMERIC) * 1000 >= :minValue
        WHEN job.revenue LIKE '%M' THEN 
          CAST(REGEXP_REPLACE(job.revenue, '[^0-9.]', '', 'g') AS NUMERIC) >= :minValue
        ELSE false
      END
    `, { minValue: range.min });
    } else {
      qb.andWhere(`
      CASE 
        WHEN job.revenue LIKE '%B' THEN 
          CAST(REGEXP_REPLACE(job.revenue, '[^0-9.]', '', 'g') AS NUMERIC) * 1000 BETWEEN :minValue AND :maxValue
        WHEN job.revenue LIKE '%M' THEN 
          CAST(REGEXP_REPLACE(job.revenue, '[^0-9.]', '', 'g') AS NUMERIC) BETWEEN :minValue AND :maxValue
        ELSE false
      END
    `, { minValue: range.min, maxValue: range.max });
    }
  }

  private async applySalaryRangeFilter(qb: SelectQueryBuilder<Job>, salaryMin?: string, salaryMax?: string): Promise<void> {
    const minValue = salaryMin ? parseInt(salaryMin) * 1000 : 0; // Convert from k to actual value
    const maxValue = salaryMax ? parseInt(salaryMax) * 1000 : 999999999; // Large number if no max

    qb.andWhere(`
      CASE 
        WHEN job.salary ~ '^\\$[0-9,]+(/yr|/year)?$' THEN 
          CAST(REGEXP_REPLACE(job.salary, '[^0-9]', '', 'g') AS NUMERIC) BETWEEN :minSalary AND :maxSalary
        WHEN job.salary ~ '^\\$[0-9,]+k(/yr|/year)?$' THEN 
          CAST(REGEXP_REPLACE(job.salary, '[^0-9]', '', 'g') AS NUMERIC) * 1000 BETWEEN :minSalary AND :maxSalary
        WHEN job.salary ~ '^\\$[0-9,]+(\\.[0-9]+)?K(/yr|/year)?$' THEN 
          CAST(REGEXP_REPLACE(job.salary, '[^0-9.]', '', 'g') AS NUMERIC) * 1000 BETWEEN :minSalary AND :maxSalary
        WHEN job.salary ~ '^[0-9,]+k$' THEN 
          CAST(REGEXP_REPLACE(job.salary, '[^0-9]', '', 'g') AS NUMERIC) * 1000 BETWEEN :minSalary AND :maxSalary
        WHEN job.salary ~ '^[0-9,]+K$' THEN 
          CAST(REGEXP_REPLACE(job.salary, '[^0-9]', '', 'g') AS NUMERIC) * 1000 BETWEEN :minSalary AND :maxSalary
        ELSE FALSE
      END
    `, { minSalary: minValue, maxSalary: maxValue });
  }

  private applySorting(qb: SelectQueryBuilder<Job>, sort: string): void {
    switch (sort) {
      case 'newest':
        qb.orderBy(`
        CASE
          WHEN "job"."datePosted" ~ '^[0-9]+h$' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 hour' * CAST(REGEXP_REPLACE("job"."datePosted", '[^0-9]', '', 'g') AS INTEGER)
          WHEN "job"."datePosted" ~ '^[0-9]+ hours? ago$' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 hour' * CAST(REGEXP_REPLACE("job"."datePosted", '[^0-9]', '', 'g') AS INTEGER) - INTERVAL '1 minute'
          WHEN "job"."datePosted" = '0d' OR "job"."datePosted" ILIKE '%today%' THEN
            CURRENT_TIMESTAMP - INTERVAL '23 hours' - INTERVAL '59 minutes'
          WHEN "job"."datePosted" ~ '^[0-9]+d$' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 day' * CAST(REGEXP_REPLACE("job"."datePosted", '[^0-9]', '', 'g') AS INTEGER)
          WHEN "job"."datePosted" ~ '^[0-9]+ days? ago$' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 day' * CAST(REGEXP_REPLACE("job"."datePosted", '[^0-9]', '', 'g') AS INTEGER)
          WHEN "job"."datePosted" ILIKE '%yesterday%' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 day'
          ELSE "job"."createdAt"
        END
      `, 'DESC');
        break;
      case 'oldest':
        qb.orderBy(`
        CASE
          WHEN "job"."datePosted" ~ '^[0-9]+h$' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 hour' * CAST(REGEXP_REPLACE("job"."datePosted", '[^0-9]', '', 'g') AS INTEGER)
          WHEN "job"."datePosted" ~ '^[0-9]+ hours? ago$' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 hour' * CAST(REGEXP_REPLACE("job"."datePosted", '[^0-9]', '', 'g') AS INTEGER) - INTERVAL '1 minute'
          WHEN "job"."datePosted" = '0d' OR "job"."datePosted" ILIKE '%today%' THEN
            CURRENT_TIMESTAMP - INTERVAL '23 hours' - INTERVAL '59 minutes'
          WHEN "job"."datePosted" ~ '^[0-9]+d$' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 day' * CAST(REGEXP_REPLACE("job"."datePosted", '[^0-9]', '', 'g') AS INTEGER)
          WHEN "job"."datePosted" ~ '^[0-9]+ days? ago$' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 day' * CAST(REGEXP_REPLACE("job"."datePosted", '[^0-9]', '', 'g') AS INTEGER)
          WHEN "job"."datePosted" ILIKE '%yesterday%' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 day'
          ELSE "job"."createdAt"
        END
      `, 'ASC');
        break;
      case 'salary-high':
        qb.orderBy(`
        CASE
          WHEN "job"."salary" ~ '^\\$[0-9,]+(/hr)?$' THEN
            CAST(REGEXP_REPLACE("job"."salary", '[^0-9]', '', 'g') AS NUMERIC)
          ELSE 0
        END
      `, 'DESC', 'NULLS LAST');
        break;
      case 'salary-low':
        qb.orderBy(`
        CASE
          WHEN "job"."salary" ~ '^\\$[0-9,]+(/hr)?$' THEN
            CAST(REGEXP_REPLACE("job"."salary", '[^0-9]', '', 'g') AS NUMERIC)
          ELSE 0
        END
      `, 'ASC', 'NULLS LAST');
        break;
      default:
        qb.orderBy(`
        CASE
          WHEN "job"."datePosted" ~ '^[0-9]+h$' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 hour' * CAST(REGEXP_REPLACE("job"."datePosted", '[^0-9]', '', 'g') AS INTEGER)
          WHEN "job"."datePosted" ~ '^[0-9]+ hours? ago$' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 hour' * CAST(REGEXP_REPLACE("job"."datePosted", '[^0-9]', '', 'g') AS INTEGER) - INTERVAL '1 minute'
          WHEN "job"."datePosted" = '0d' OR "job"."datePosted" ILIKE '%today%' THEN
            CURRENT_TIMESTAMP - INTERVAL '23 hours' - INTERVAL '59 minutes'
          WHEN "job"."datePosted" ~ '^[0-9]+d$' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 day' * CAST(REGEXP_REPLACE("job"."datePosted", '[^0-9]', '', 'g') AS INTEGER)
          WHEN "job"."datePosted" ~ '^[0-9]+ days? ago$' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 day' * CAST(REGEXP_REPLACE("job"."datePosted", '[^0-9]', '', 'g') AS INTEGER)
          WHEN "job"."datePosted" ILIKE '%yesterday%' THEN
            CURRENT_TIMESTAMP - INTERVAL '1 day'
          ELSE "job"."createdAt"
        END
      `, 'DESC');
    }
  }

  async createUnverifiedUser(userData: Partial<User>): Promise<User | null> {
    try {
      if (!userData.email) {
        throw new BadRequestException('Email is required');
      }

      const checkUserExists = await this.isActiveUser(userData.email);

      if (checkUserExists) {
        throw new BadRequestException('Email already exists');
      }

      const user = this.userRepository.create(userData);
      return await this.userRepository.save(user);
    } catch (err) {
      this.logger.error('Error creating user:', err);

      if (err instanceof BadRequestException) {
        throw err;
      }

      throw new InternalServerErrorException('Failed to create user');
    }
  }

  async verifyUserWithOtp(email: string, otp: string): Promise<User | null> {
    try {
      const user = await this.userRepository.findOneBy({ email });

      if (!user || user.verificationCode !== otp || !user.verificationExpiry || new Date() > user.verificationExpiry) {
        this.logger.error('Invalid OTP or user not found');
        throw new BadRequestException("Invalid OTP or user not found");
      }

      user.isVerified = true;
      user.verificationCode = null;
      user.verificationExpiry = null;
      return await this.userRepository.save(user);
    } catch (err) {
      this.logger.error("Error verifying user OTP", err)
      throw err;
    }
  }

  async updateUserOtp(
    userId: string,
    otp: string,
    expiry: Date,
  ): Promise<void> {
    try {
      const user = await this.userRepository.findOneBy({ id: userId });
      if (!user) {
        throw new BadRequestException('User not found');
      }

      user.verificationCode = otp;
      user.verificationExpiry = expiry;
      await this.userRepository.save(user);
    } catch (err) {
      this.logger.error("Error updating OTP", err)
      throw err;
    }
  }

  async getUser(email: string): Promise<User | null> {
    try {
      return await this.userRepository.findOneBy({ email });
    } catch (err) {
      this.logger.error("Error fetching user", err)
      throw err;
    }
  }

  async isActiveUser(email: string): Promise<boolean> {
    try {
      const checkIfVerified = await this.userRepository.findOneBy({ email, isVerified: true });
      return checkIfVerified ? true : false;
    } catch (err) {
      this.logger.error("Error fetching user", err)
      throw err;
    }
  }

  async resetUserPassword(email: string, hashedPassword: string): Promise<void> {
    try {
      const user = await this.userRepository.findOneBy({ email });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      user.password = hashedPassword;
      await this.userRepository.save(user);

      this.logger.log(`Password updated for user: ${email}`);
    } catch (err) {
      this.logger.error('Error updating user password:', err);

      if (err instanceof BadRequestException) {
        throw err;
      }

      throw new InternalServerErrorException('Failed to update password');
    }
  }

  async saveSearches(searchesData: Partial<Search>): Promise<Search | null> {
    try {
      const searches = this.searchesRepository.create(searchesData);
      return await this.searchesRepository.save(searches);
    } catch (err) {
      this.logger.error('Error creating searches', err);
      throw err;
    }
  }

  async fetchUserSearches(userId: string): Promise<Search[]> {
    try {
      const searches = await this.searchesRepository.find({ where: { user: { id: userId } } });
      return searches;
    } catch (err) {
      this.logger.error('Error fetching searches', err);
      throw err;
    }
  }

  async updateSearchAlert(searchId: number, alert: boolean): Promise<Search | null> {
    try {
      const search = await this.searchesRepository.findOneBy({ id: searchId });
      if (!search) {
        throw new BadRequestException('Search not found');
      }

      search.alert = alert;
      return await this.searchesRepository.save(search);
    } catch (err) {
      this.logger.error("Error setting search alert", err)
      throw err;
    }
  }

  async getAllNewJobs(): Promise<{ userEmail: string, jobs: Job[] }[]> {
    try {
      const activeUsers = await this.userRepository.find({
        where: { isVerified: true },
        select: ['id', 'email'],
        relations: ['searches']
      });

      const results = await Promise.all(
        activeUsers.map(async (user) => {
          const activeSearches = user.searches?.filter(search => search.alert) || [];

          if (activeSearches.length === 0) {
            return { userEmail: user.email, jobs: [] };
          }

          const searchCriteria = this.combineSearchCriteria(activeSearches);

          const jobsResult = await this.searchJobs({
            search: '',
            limit: 20,
            page: 1,
            title: searchCriteria.titles.join('|'),
            company: searchCriteria.companies.join('|'),
            location: searchCriteria.locations.join('|'),
            keyword: searchCriteria.keywords.join('|'),
          }, true);

          return { userEmail: user.email, jobs: jobsResult.data };
        })
      );

      return results;
    } catch (err) {
      this.logger.error("Error getting new jobs", err);
      throw err;
    }
  }

  private combineSearchCriteria(searches: Search[]): {
    titles: string[];
    companies: string[];
    locations: string[];
    keywords: string[];
  } {
    const criteria = {
      titles: [] as string[],
      companies: [] as string[],
      locations: [] as string[],
      keywords: [] as string[],
    };

    searches.forEach(search => {
      if (search.title) criteria.titles.push(search.title);
      if (search.company) criteria.companies.push(search.company);
      if (search.location) criteria.locations.push(search.location);
      if (search.keywords) criteria.keywords.push(search.keywords);
    });

    criteria.titles = [...new Set(criteria.titles)];
    criteria.companies = [...new Set(criteria.companies)];
    criteria.locations = [...new Set(criteria.locations)];
    criteria.keywords = [...new Set(criteria.keywords)];

    return criteria;
  }

  async deleteJobsOlderThan(days: number): Promise<{
    deletedCount: number;
    cutoffDate: Date;
    retentionDays: number;
  }> {
    this.logger.log(`Starting cleanup of jobs older than ${days} days`);

    try {
      const retentionDays = days || 60;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      this.logger.log(`Cutoff date calculated: ${cutoffDate.toISOString()}`);
      this.logger.log(`Jobs created before ${cutoffDate.toISOString()} will be deleted`);

      const jobsToDelete = await this.jobRepository
        .createQueryBuilder('job')
        .where('job.createdAt < :cutoffDate', { cutoffDate })
        .getCount();

      this.logger.log(`Found ${jobsToDelete} jobs to delete`);

      if (jobsToDelete === 0) {
        this.logger.log('No jobs to delete - database is clean');
        return {
          deletedCount: 0,
          cutoffDate,
          retentionDays: days,
        };
      }

      // Execute deletion
      const deleteResult = await this.jobRepository
        .createQueryBuilder()
        .delete()
        .from(Job)
        .where('createdAt < :cutoffDate', { cutoffDate })
        .execute();

      const deletedCount = deleteResult.affected || 0;

      this.logger.log(`Successfully deleted ${deletedCount} job(s) older than ${days} days`);
      this.logger.log(`Cleanup summary: ${deletedCount} jobs removed, cutoff date: ${cutoffDate.toISOString()}`);

      return {
        deletedCount,
        cutoffDate,
        retentionDays: days,
      };
    } catch (error) {
      this.logger.error('Error during job cleanup:', error);
      this.logger.error('Error details:', {
        message: error.message,
        stack: error.stack,
        retentionDays: days,
      });

      throw new InternalServerErrorException(
        `Failed to cleanup old jobs: ${error.message}`
      );
    }
  }
}
