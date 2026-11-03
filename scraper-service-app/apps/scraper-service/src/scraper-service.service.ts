import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, last } from 'rxjs';
import * as cheerio from 'cheerio';
import { ConfigService } from '@nestjs/config';
import { isValid, parse } from 'date-fns';
import { ApifyClient } from 'apify-client';

import { CompanyIndustryInfo } from './interface';
import { CompanyIndustryService } from './company-industry.service';

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const proxyChain = require('proxy-chain');

@Injectable()
export class ScraperServiceService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly companyIndustryService: CompanyIndustryService,

  ) {
    this.DATAIMPULSE_PASSWORD = this.configService.get<string>('DATAIMPULSE_PASSWORD');
    this.DATAIMPULSE_USERNAME = this.configService.get<string>('DATAIMPULSE_USERNAME');
    this.DATAIMPULSE_PROXY_HOST = this.configService.get<string>('DATAIMPULSE_PROXY_HOST');
    this.DATAIMPULSE_PROXY_PORT = this.configService.get<string>('DATAIMPULSE_PROXY_PORT');
    this.INDEED_APIFY_API_TOKEN = this.configService.get<string>('INDEED_APIFY_API_TOKEN');
    this.LINKEDIN_APIFY_API_TOKEN = this.configService.get<string>('LINKEDIN_APIFY_API_TOKEN');
    this.INDEED_ACTOR_ID = this.configService.get<string>('INDEED_ACTOR_ID');
    this.LINKEDIN_ACTOR_ID = this.configService.get<string>('LINKEDIN_ACTOR_ID');
    this.indeedApifyClient = new ApifyClient({
      token: this.INDEED_APIFY_API_TOKEN,
    });
    this.linkedInApifyClient = new ApifyClient({
      token: this.LINKEDIN_APIFY_API_TOKEN,
    });
    this.SERPER_API_KEY = this.configService.get<string>('SERPER_API_KEY');
  }
  private abortController = new AbortController();
  private readonly logger = new Logger(ScraperServiceService.name);
  private readonly JOB_TITLE = 'Controller, CFO, VP of Finance';
  private readonly LOCATION = 'United States';
  private readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
  private readonly DATAIMPULSE_USERNAME: string | undefined;
  private readonly DATAIMPULSE_PASSWORD: string | undefined;
  private readonly DATAIMPULSE_PROXY_HOST: string | undefined;
  private readonly DATAIMPULSE_PROXY_PORT: string | undefined;

  private readonly SERPER_API_KEY: string | undefined;
  private readonly SERPER_API_ENDPOINT = 'https://google.serper.dev/search';

  private readonly INDEED_APIFY_API_TOKEN: string | undefined;
  private readonly LINKEDIN_APIFY_API_TOKEN: string | undefined;
  private INDEED_ACTOR_ID: any;
  private LINKEDIN_ACTOR_ID: any;
  private indeedApifyClient: ApifyClient;
  private linkedInApifyClient: ApifyClient;

  private getProxyUrl(): string {
    return `http://${this.DATAIMPULSE_USERNAME}:${this.DATAIMPULSE_PASSWORD}@${this.DATAIMPULSE_PROXY_HOST}:${this.DATAIMPULSE_PROXY_PORT}`;
  }

  private isValidCompanyName(company: string): boolean {
    if (!company || typeof company !== 'string') return false;

    const trimmed = company.trim();

    if (trimmed === '') return false;

    if (/^\d+\.?\d*$/.test(trimmed)) return false;

    if (trimmed.length < 2) return false;

    if (!/[a-zA-Z]/.test(trimmed)) return false;

    return true;
  }

  private validateJobData(job: any): boolean {
    if (!job.title || typeof job.title !== 'string' || job.title.trim() === '') {
      this.logger.warn('Invalid job title:', job.title);
      return false;
    }

    if (!this.isValidCompanyName(job.company)) {
      this.logger.warn('Invalid job company:', job.company);
      return false;
    }

    if (!job.jobUrl || typeof job.jobUrl !== 'string' || job.jobUrl.trim() === '') {
      this.logger.warn('Invalid job URL:', job.jobUrl);
      return false;
    }

    try {
      new URL(job.jobUrl);
    } catch (err) {
      this.logger.warn('Invalid job URL format:', job.jobUrl);
      return false;
    }

    return true;
  }

  private cleanJobData(job: any): any {
    return {
      title: job.title?.toString().trim() || '',
      company: job.company?.toString().trim() || '',
      location: job.location?.toString().trim() || 'Not specified',
      salary: job.salary?.toString().trim() || 'Not specified',
      jobUrl: job.jobUrl?.toString().trim() || '',
      datePosted: job.datePosted?.toString().trim() || 'Unknown',
      description: job.description?.toString().trim() || 'No description available',
      source: job.source?.toString().trim() || 'Unknown'
    };
  }

  private async cleanupOldJobs(): Promise<void> {
    const storageHost = this.configService.get<string>('STORAGE_SERVICE_HOST');
    const cleanupEndpoint = `${storageHost}/jobs/cleanup`;
    const retentionDays = this.configService.get<number>('JOB_RETENTION_DAYS', 60);

    this.logger.log(`🧹 Initiating cleanup of jobs older than ${retentionDays} days`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(cleanupEndpoint, null, {
          params: { days: retentionDays },
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          timeout: 60000,
        })
      );

      if (response.data.success) {
        this.logger.log(`Cleanup completed successfully`);
        this.logger.log(`Cleanup statistics:`, {
          deletedCount: response.data.deletedCount,
          cutoffDate: response.data.cutoffDate,
          retentionDays: response.data.retentionDays,
        });
      } else {
        this.logger.warn(`Cleanup returned unsuccessful status:`, response.data);
      }
    } catch (error) {
      this.logger.error('Error during cleanup (scraping will continue):', error.message);
      this.logger.error('Cleanup error details:', {
        endpoint: cleanupEndpoint,
        retentionDays: retentionDays,
        stack: error.stack,
      });

      if (error.response) {
        this.logger.error('Cleanup HTTP error response:', {
          status: error.response.status,
          data: error.response.data,
        });
      }
    }
  }

  async scrapeJobListing(): Promise<void> {
    this.abortController = new AbortController();

    await this.cleanupOldJobs();

    await this.withRetry(async () => {
      try {
        puppeteerExtra.use(StealthPlugin());
        const authenticatedProxyUrl = await proxyChain.anonymizeProxy(this.getProxyUrl());

        const puppeteerOpts = this.configService.get<any>('NODE_ENV') !== 'development' ? {
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
          headless: "new",
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1280,720',
            `--display=${process.env.DISPLAY || ':99'}`,
            '--disable-software-rasterizer',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-blink-features=AutomationControlled',
            `--user-agent=${this.getRandomUserAgent()}`,
            `--proxy-server=${authenticatedProxyUrl}`,
            '--ignore-certificate-errors',
          ],
          ignoreHTTPSErrors: true,
          dumpio: false,
          timeout: 60000
        } : {
          headless: "new",
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1280,720',
            `--display=${process.env.DISPLAY || ':99'}`,
            '--disable-software-rasterizer',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-blink-features=AutomationControlled',
            `--user-agent=${this.getRandomUserAgent()}`,
            `--proxy-server=${authenticatedProxyUrl}`,
            '--ignore-certificate-errors',
          ],
          ignoreHTTPSErrors: true,
          dumpio: false,
          timeout: 60000
        };

        // Run Apify actors first with delays in between
        await this.scrapeIndeedViaApify();
        await this.randomDelay(30000, 60000);

        await this.scrapeLinkedInViaApify();
        await this.randomDelay(30000, 60000);

        const browser = await puppeteerExtra.launch(puppeteerOpts);

        try {
          await this.scrapeSimplyHired(browser);
          await this.randomDelay(30000, 60000);
          await this.scrapeZipRecruiter(browser);
        } finally {
          await browser.close();
        }
      } catch (err) {
        this.logger.error('Scraping failed', err.stack);
      } finally {
        this.abortController.abort();
        await this.onScrapeComplete();
      }
    }, 2, 10000);
  }

  private async handleProxyAuthentication(page: any): Promise<void> {
    try {
      await page.authenticate({
        username: this.DATAIMPULSE_USERNAME,
        password: this.DATAIMPULSE_PASSWORD
      });
    } catch (error) {
      this.logger.warn('Proxy authentication may not be required or failed:', error.message);
    }
  }

  private async createNewPage(browser: any): Promise<any> {
    const MAX_RETRIES = 3;
    let retries = 0;

    while (retries < MAX_RETRIES) {
      try {
        const page = await browser.newPage();

        await page.setCacheEnabled(false);

        await page.setViewport({
          width: 1280 + Math.floor(Math.random() * 100),
          height: 800 + Math.floor(Math.random() * 100),
          deviceScaleFactor: 1
        });

        await page.setUserAgent(this.getRandomUserAgent());
        await page.setDefaultNavigationTimeout(120000);
        await page.setDefaultTimeout(60000);

        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5].sort(() => Math.random() - 0.5)
          });
          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'].sort(() => Math.random() - 0.5)
          });
          Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => 4 + Math.floor(Math.random() * 4)
          });
          delete Object.getPrototypeOf(navigator).webdriver;
          Object.defineProperty(window.navigator, 'chrome', {
            get: () => ({ runtime: {} })
          });
          Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
          Object.defineProperty(navigator, 'connection', {
            get: () => ({
              downlink: 10,
              effectiveType: '4g',
              rtt: 100,
              saveData: false,
              type: 'wifi'
            })
          });
        });

        return page;
      } catch (err) {
        retries++;
        this.logger.warn(`Page creation attempt ${retries} failed: ${err.message}`);
        if (retries >= MAX_RETRIES) throw err;
        await new Promise(r => setTimeout(r, 5000 * retries));
      }
    }
  }

  private getRandomUserAgent(): string {
    const agents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
    ];
    return agents[Math.floor(Math.random() * agents.length)];
  }

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3, delay = 5000): Promise<T> {
    let retries = 0;
    let lastError: Error = new Error("Operation failed");

    while (retries < maxRetries) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        retries++;
        this.logger.warn(`Attempt ${retries} failed: ${error.message}`);

        if (retries < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delay * retries));
        }
      }
    }

    throw lastError;
  }

  private async navigateWithRetries(page: any, url: string): Promise<void> {
    const MAX_RETRIES = 3;
    let retries = 0;

    while (retries < MAX_RETRIES) {
      try {
        // Handle proxy authentication
        await this.handleProxyAuthentication(page);

        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 120000
        });

        this.logger.debug("Page response", response?.status());

        if (!response || !response.ok()) {
          throw new Error(`HTTP ${response?.status() || 'unknown'} - ${url}`);
        }

        await page.waitForSelector('body', { timeout: 30000 });

        const isBlocked = await page.evaluate(() => {
          return document.body.innerText.includes('captcha') ||
            document.body.innerText.includes('blocked') ||
            document.body.innerText.includes('denied') ||
            document.querySelector('iframe[src*="captcha"]') !== null;
        });

        if (isBlocked) {
          throw new Error('Page is blocked or showing captcha');
        }

        const pageContent = await page.content();
        if (pageContent.includes('proxy') || pageContent.includes('authentication')) {
          throw new Error('Proxy authentication required');
        }

        return;
      } catch (err) {
        retries++;
        this.logger.warn(`Navigation attempt ${retries} failed for ${url}: ${err.message}`);

        if (err.message.includes('proxy') || err.message.includes('authentication')) {
          await this.handleProxyAuthentication(page);
        }

        if (retries >= MAX_RETRIES) throw err;
        await new Promise(r => setTimeout(r, 10000 * retries));

        try {
          await page.click('button[aria-label="Close"], .modal-close, .close-button', { timeout: 2000 });
        } catch { }
      }
    }
  }

  private isToday(dateString: string): boolean {
    if (!dateString) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Normalize the date first
    const normalizedDate = this.normalizeZipRecruiterDate(dateString);

    // Check for immediate indicators
    if (normalizedDate.includes('hours ago') || normalizedDate.includes('hour ago') ||
      normalizedDate.match(/^\d+h$/)) {
      return true;
    }

    if (normalizedDate.includes('today') || normalizedDate.includes('Just posted') ||
      normalizedDate === '0d') {
      return true;
    }

    if (normalizedDate === '1d' || normalizedDate.includes('1 day ago')) {
      return true;
    }

    // Handle minute-level posts as today
    if (normalizedDate.match(/^\d+m$/)) {
      return true;
    }

    const parsedDate = this.parseJobDate(dateString);
    if (!parsedDate) return false;

    return parsedDate.toDateString() === today.toDateString();
  }

  private normalizeZipRecruiterDate(dateString: string): string {
    if (!dateString) return 'Unknown';

    // Handle ZipRecruiter format: "Posted X days ago" or "Posted X hours ago"
    const zipRecruiterMatch = dateString.match(/Posted\s+(\d+)\s+(day|hour|minute)s?\s+ago/i);

    if (zipRecruiterMatch) {
      const number = zipRecruiterMatch[1];
      const unit = zipRecruiterMatch[2].toLowerCase();

      if (unit === 'day') {
        return `${number}d`;
      } else if (unit === 'hour') {
        return `${number}h`;
      } else if (unit === 'minute') {
        return `${number}m`;
      }
    }

    // Handle "Posted today" or "Posted yesterday"
    if (dateString.match(/Posted\s+today/i)) {
      return '0d';
    }

    if (dateString.match(/Posted\s+yesterday/i)) {
      return '1d';
    }

    // If it's already in the right format (like from SimplyHired), return as is
    if (dateString.match(/^\d+[hdm]$/)) {
      return dateString;
    }

    return dateString; // Return original if no match
  }

  private parseJobDate(dateString: string): Date | null {
    if (!dateString) return null;

    const now = new Date();

    // First normalize ZipRecruiter dates
    const normalizedDate = this.normalizeZipRecruiterDate(dateString);

    // Handle the normalized format (both from SimplyHired and normalized ZipRecruiter)
    const hourMatch = normalizedDate.match(/^(\d+)h$/i);
    if (hourMatch) {
      const hoursAgo = parseInt(hourMatch[1], 10);
      const date = new Date();
      date.setHours(date.getHours() - hoursAgo);
      return date;
    }

    const dayMatch = normalizedDate.match(/^(\d+)d$/i);
    if (dayMatch) {
      const daysAgo = parseInt(dayMatch[1], 10);
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      return date;
    }

    const minuteMatch = normalizedDate.match(/^(\d+)m$/i);
    if (minuteMatch) {
      const minutesAgo = parseInt(minuteMatch[1], 10);
      const date = new Date();
      date.setMinutes(date.getMinutes() - minutesAgo);
      return date;
    }

    // Handle legacy patterns for backward compatibility
    if (normalizedDate.includes('day')) {
      const daysAgo = parseInt(normalizedDate, 10) || 0;
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      return date;
    }

    if (normalizedDate.includes('hour')) {
      const hoursAgo = parseInt(normalizedDate, 10) || 0;
      const date = new Date();
      date.setHours(date.getHours() - hoursAgo);
      return date;
    }

    try {
      const formats = [
        'MM/DD/YYYY',
        'MMM DD, YYYY',
        'MMMM DD, YYYY',
        'YYYY-MM-DD'
      ];

      for (const format of formats) {
        const parsed = parse(normalizedDate, format, now);
        if (isValid(parsed)) return parsed;
      }

      const parsed = new Date(normalizedDate);
      if (isValid(parsed)) return parsed;
    } catch (e) {
      this.logger.warn(`Failed to parse date: ${dateString} (normalized: ${normalizedDate})`);
    }

    return null;
  }

  private async processJobsWithDateFilter(jobs: any[]): Promise<void> {
    for (const job of jobs) {
      try {
        // Clean and validate job data first
        const cleanedJob = this.cleanJobData(job);

        if (!this.validateJobData(cleanedJob)) {
          this.logger.warn('Job validation failed, skipping:', {
            title: cleanedJob.title,
            company: cleanedJob.company,
            url: cleanedJob.jobUrl
          });
          continue;
        }

        // Log both original and normalized dates for debugging
        const normalizedDate = this.normalizeZipRecruiterDate(cleanedJob.datePosted);
        this.logger.debug(`Date processing - Original: "${cleanedJob.datePosted}" | Normalized: "${normalizedDate}"`);

        if (!this.isToday(cleanedJob.datePosted)) {
          this.logger.debug(`Skipping job from ${cleanedJob.datePosted} (normalized: ${normalizedDate}): ${cleanedJob.title}`);
          continue;
        }

        // Store the job with normalized date for consistency
        const jobToStore = {
          ...cleanedJob,
          datePosted: normalizedDate
        };

        await this.storeJob(jobToStore);
        await this.randomDelay(1000, 3000);
      } catch (err) {
        this.logger.error(`Error processing job: ${err.message}`);
      }
    }
  }

  private async scrapeSimplyHired(browser: any): Promise<void> {
    const BASE_URL = "https://www.simplyhired.com"
    let currentPage = 1;
    const maxPages = 15;
    let successCount = 0;
    let browserRefreshCounter = 0;

    try {
      this.logger.log("Starting SimplyHired scraping");
      while (currentPage <= maxPages) {
        if (successCount > 0 && successCount % 5 === 0) {
          this.logger.log("Performing health check...");
          if (!await this.checkBrowserHealth(browser)) {
            throw new Error('Browser health check failed');
          }
        }

        const page = await this.createNewPage(browser);

        try {
          this.logger.log(`Processing SimplyHired page ${currentPage}`)
          const url = `${BASE_URL}/search?q=${encodeURIComponent(this.JOB_TITLE)}&l=${encodeURIComponent(this.LOCATION)}&pn=${currentPage}&t=1`;

          await this.navigateWithRetries(page, url)
          await this.simulateHumanBehavior(page);

          const html = await page.content();
          const $ = cheerio.load(html);

          const jobElements = $('[data-testid="searchSerpJob"]').toArray();
          if (jobElements.length === 0) {
            this.logger.warn(`No job elements found on page ${currentPage}, ending scraping`);
            break;
          }

          this.logger.log(`Found ${jobElements.length} job elements on page ${currentPage}`);

          const batchSize = 3;
          for (let i = 0; i < jobElements.length; i += batchSize) {
            const batch = jobElements.slice(i, i + batchSize);
            const batchResults = await Promise.all(
              batch.map(async (el, index) => {
                try {
                  const title = $(el).find('h2.chakra-text').text().trim();
                  const companyElement = $(el).find('p.chakra-text > span > span');
                  const fullCompanyText = companyElement.text().trim();

                  let company = fullCompanyText;
                  let rating: number | null = null;

                  // First try to match company name with star rating
                  const ratingMatch = fullCompanyText.match(/(.+?)\s*(\d+\.?\d*)\s*★?\s*$/);
                  if (ratingMatch && ratingMatch[1].trim().length > 0) {
                    const potentialCompany = ratingMatch[1].trim();
                    const potentialRating = parseFloat(ratingMatch[2]);

                    // Only use this parsing if the company name is valid
                    if (this.isValidCompanyName(potentialCompany) && potentialRating >= 0 && potentialRating <= 5) {
                      company = potentialCompany;
                      rating = potentialRating;
                    }
                  } else {
                    // Try alternate parsing for company name with number at end
                    const altRatingMatch = fullCompanyText.match(/(.+?)\s+(\d+\.?\d*)\s*$/);
                    if (altRatingMatch && altRatingMatch[1].trim().length > 0) {
                      const potentialCompany = altRatingMatch[1].trim();
                      const potentialRating = parseFloat(altRatingMatch[2]);

                      // Only extract if it looks like a rating (0-5 range) and company is valid
                      if (this.isValidCompanyName(potentialCompany) && potentialRating >= 0 && potentialRating <= 5) {
                        company = potentialCompany;
                        rating = potentialRating;
                      }
                    }
                  }

                  // Final validation: if company is still invalid, mark the whole job as invalid
                  if (!this.isValidCompanyName(company)) {
                    this.logger.warn(`Invalid company name extracted: "${fullCompanyText}" -> "${company}"`);
                    return null;
                  }

                  const location = $(el).find('p.chakra-text > span[data-testid="searchSerpJobLocation"]').text().trim();
                  const salary = $(el).find('p[data-testid="searchSerpJobSalaryConfirmed"]').text().trim() || 'Not specified';
                  const datePosted = $(el).find('p[data-testid="searchSerpJobDateStamp"]').text().trim();
                  const linkHref = $(el).find('a').attr('href');

                  // Enhanced validation and link construction
                  if (!title || !company || !linkHref) {
                    this.logger.warn(`Missing critical data for job ${i + index + 1}:`, { title, company, linkHref });
                    return null;
                  }

                  const link = linkHref.startsWith('http') ? linkHref : BASE_URL + linkHref;

                  let description = 'No description available';
                  try {
                    description = await this.scrapeSimplyHiredJobDescription(browser, link);
                  } catch (err) {
                    this.logger.error(`Failed to scrape description for ${link}:`, err.message);
                  }

                  return {
                    title: title || 'No title',
                    company: company || 'Unknown company',
                    location: location || 'Not specified',
                    salary: salary || 'Not specified',
                    jobUrl: link,
                    datePosted: datePosted || 'Unknown',
                    description: description || 'No description available',
                    source: "SimplyHired"
                  };
                } catch (err) {
                  this.logger.error(`Failed to process job element ${i + index + 1}:`, err.message);
                  return null;
                }
              })
            );

            const validJobs = batchResults.filter(job => {
              if (!job) return false;
              const cleaned = this.cleanJobData(job);
              return this.validateJobData(cleaned);
            });

            this.logger.log(`Processed batch: ${validJobs.length}/${batchResults.length} valid jobs`);

            if (validJobs.length > 0) {
              await this.processJobsWithDateFilter(validJobs);
            }
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
          }

          successCount++;
          currentPage++;
          browserRefreshCounter++;
        } finally {
          try {
            await page.close();
          } catch (err) {
            this.logger.error('Error closing page:', err);
          }
        }
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
      }
    } catch (err) {
      this.logger.error('SimplyHired scraping failed', err.stack);
    }
  }

  private async randomDelay(min: number, max: number) {
    await new Promise(r =>
      setTimeout(r, Math.floor(Math.random() * (max - min) + min)
      ))
  }

  private async scrapeSimplyHiredJobDescription(browser: any, url: string): Promise<string> {
    const page = await browser.newPage();
    try {
      await page.setUserAgent(this.getRandomUserAgent());

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      if (!response || !response.ok()) {
        throw new Error(`HTTP ${response?.status() || 'unknown'} - ${url}`);
      }

      await page.waitForFunction(() => {
        const desc: any = document.querySelector('[data-testid="viewJobBodyJobFullDescriptionContent"]');
        return desc && desc.textContent.trim().length > 0;
      }, { timeout: 30000 });

      const description = await page.$eval(
        '[data-testid="viewJobBodyJobFullDescriptionContent"]',
        el => el.textContent.trim()
      );

      return description || 'No description available';
    } catch (err) {
      this.logger.error(`Error scraping SimplyHired description from ${url}:`, err.message);
      return 'Description unavailable';
    } finally {
      await page.close();
    }
  }

  private async scrapeZipRecruiter(browser: any): Promise<void> {
    const BASE_URL = "https://www.ziprecruiter.com"
    let currentPage = 1;
    const maxPages = 15;
    let successCount = 0;

    try {
      this.logger.log("Starting ZipRecruiter scraping");

      while (currentPage <= maxPages) {
        if (successCount > 0 && successCount % 5 === 0) {
          this.logger.log("Performing health check...");
          if (!await this.checkBrowserHealth(browser)) {
            throw new Error('Browser health check failed');
          }
        }

        const page = await this.createNewPage(browser);

        try {
          await this.handleProxyAuthentication(page);
          this.logger.log(`Processing ZipRecruiter page ${currentPage}`)
          const url = `${BASE_URL}/jobs-search?search=${encodeURIComponent(this.JOB_TITLE)}&location=${encodeURIComponent(this.LOCATION)}&days=1&page=${currentPage}`;

          await this.randomDelay(3000, 8000);
          await page.setUserAgent(this.USER_AGENT);
          await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
          });

          await this.navigateWithRetries(page, url);
          await this.simulateHumanBehavior(page);
          await this.randomDelay(2000, 5000);

          // Handle modals
          try {
            await page.waitForSelector('div.modal, div[role="dialog"]', { timeout: 5000 });
            await page.click('button[aria-label="Close"], .modal-close, .close-button');
            this.logger.log('Closed email signup modal');
            await new Promise(r => setTimeout(r, 1000));
          } catch (err) {
            this.logger.log('No modal found or could not close it');
          }

          const isBlocked = await page.evaluate(() => {
            return document.body.innerText.includes('captcha') ||
              document.body.innerText.includes('blocked') ||
              document.body.innerText.includes('denied');
          });

          if (isBlocked) {
            throw new Error('Page is blocked or showing captcha');
          }

          // Wait for job cards to load
          await page.waitForSelector('div.job_result_two_pane_v2, article.job_result, div.jobCard, [data-job-id]', { timeout: 35000 });

          // Get job count instead of storing elements
          const jobCount = await page.$$eval('div.job_result_two_pane_v2, article.job_result, div.jobCard', elements => elements.length);

          if (jobCount === 0) {
            this.logger.warn('No ZipRecruiter job elements found');
            break;
          }

          this.logger.log(`Found ${jobCount} ZipRecruiter job elements`);

          // Process jobs by index, re-querying each time
          for (let i = 0; i < jobCount; i++) {
            try {
              // Fresh query each iteration
              const jobElements = await page.$$('div.job_result_two_pane_v2, article.job_result, div.jobCard');

              if (i >= jobElements.length) {
                this.logger.warn(`Job element ${i + 1} no longer exists, skipping`);
                continue;
              }

              const currentElement = jobElements[i];

              // Extract basic job data
              const jobData = await currentElement.evaluate((node) => {
                const getText = (selector) =>
                  node.querySelector(selector)?.textContent?.trim() || '';

                const title = getText('h2[aria-label]') || getText('h2');
                const company = getText('a[data-testid="job-card-company"]');
                const location = getText('a[data-testid="job-card-location"]');
                const salary = getText('div.mr-8.break-all > p') || 'Not specified';

                return { title, company, location, salary };
              });

              if (!jobData.title || !jobData.company) {
                this.logger.warn(`Missing basic job data for element ${i + 1}`);
                continue;
              }

              this.logger.debug(`Processing job: ${jobData.title} at ${jobData.company}`);

              // Click to open modal
              await currentElement.click();
              await new Promise(r => setTimeout(r, 1500)); // Wait for modal

              // Try to find modal with shorter timeout
              let modalDetails = { description: 'No description available', datePosted: 'Unknown' };

              try {
                await page.waitForSelector('[data-testid="right-pane"]', { timeout: 6000 });
                modalDetails = await this.extractModalDetails(page);
              } catch (modalError) {
                this.logger.warn(`Modal not found for job ${i + 1}, using basic data`);
              }

              // Simple modal close - just press Escape
              try {
                await page.keyboard.press('Escape');
                await new Promise(r => setTimeout(r, 1000));
              } catch (closeError) {
                this.logger.warn('Could not close modal with Escape');
              }

              const jobDetails = {
                title: jobData.title || 'No title',
                company: jobData.company || 'Unknown company',
                location: jobData.location || 'Not specified',
                salary: jobData.salary || 'Not specified',
                jobUrl: page.url(),
                datePosted: modalDetails.datePosted || 'Unknown',
                description: modalDetails.description || 'No description available',
                source: 'ZipRecruiter'
              };

              const cleanedJob = this.cleanJobData(jobDetails);
              if (this.validateJobData(cleanedJob)) {
                await this.processJobsWithDateFilter([cleanedJob]);
              }

              await this.randomDelay(2000, 4000);

            } catch (err) {
              this.logger.error(`Failed to process ZipRecruiter job element ${i + 1}:`, err.message);
              try {
                await page.keyboard.press('Escape');
                await new Promise(r => setTimeout(r, 1000));
              } catch (recoveryError) {
                // Ignore
              }

              continue;
            }
          }

          successCount++;
          currentPage++;
          await this.randomDelay(5000, 15000);

        } finally {
          try {
            await page.close();
          } catch (err) {
            this.logger.error('Error closing page:', err);
          }
        }
        await this.randomDelay(3000, 5000);
      }
    } catch (err) {
      this.logger.error('ZipRecruiter scraping failed', err.stack);
    }
  }

  private async extractModalDetails(page: any): Promise<{ description: string, datePosted: string }> {
    try {
      await page.waitForSelector('[data-testid="right-pane"]', { timeout: 10000 });

      let description = 'No description available';
      let datePosted = 'Unknown';

      try {
        description = await page.$eval(
          '[data-testid="job-details-scroll-container"] .text-primary.whitespace-pre-line.wrap-anywhere',
          el => el.textContent?.trim() || el.innerText.trim() || 'No description available'
        );
      } catch (err) {
        this.logger.warn('Could not extract description from modal:', err.message);
      }

      try {
        datePosted = await page.evaluate(() => {
          const container = document.querySelector('[data-testid="job-details-scroll-container"]');
          if (!container) return 'Unknown';

          const elements = container.querySelectorAll('p, span, div');

          for (const el of elements) {
            const text = el.textContent?.trim() || '';

            if (text.match(/Posted\s+(today|yesterday|\d+\s+(day|hour|minute)s?\s+ago)/i)) {
              return text;
            }

            if (text.startsWith('Posted') && text.length < 50) {
              return text;
            }
          }

          const flexContainers = container.querySelectorAll('[class*="flex"]');
          for (const container of flexContainers) {
            const text = container.textContent?.trim() || '';
            if (text.includes('Posted') && text.length < 100) {
              const match = text.match(/Posted\s+(.*?)(?=\s*$|\.|,|;)/i);
              return match ? `Posted ${match[1]}` : text;
            }
          }

          return 'Unknown';
        });
      } catch (err) {
        this.logger.warn('Could not extract date from modal:', err.message);
      }

      if (datePosted !== 'Unknown') {
        try {
          const cleanDate = await page.evaluate((text) => {
            const match = text.match(/Posted\s+(today|yesterday|\d+\s+(day|hour|minute)s?\s+ago)/i);
            return match ? match[0] : text;
          }, datePosted);

          datePosted = cleanDate;
        } catch (err) {
          this.logger.warn('Could not clean up date text:', err.message);
        }
      }

      return { description, datePosted };

    } catch (err) {
      this.logger.error('Error extracting modal details:', err.message);
      return { description: 'No description available', datePosted: 'Unknown' };
    }
  }

  private async scrapeIndeedViaApify(): Promise<void> {
    if (!this.INDEED_APIFY_API_TOKEN) {
      this.logger.warn('Apify API token not configured - skipping Indeed scraping');
      return;
    }

    try {
      this.logger.log('Starting Indeed scraping via Apify');

      const input = {
        position: this.JOB_TITLE,
        country: 'US',
        parseCompanyDetails: true,
        maxItems: 100,
        customData: false,
        saveHtml: false,
        saveMarkdown: false
      };

      this.logger.log('Launching Apify Indeed scraper...');
      const run = await this.indeedApifyClient.actor(this.INDEED_ACTOR_ID).call(input);

      this.logger.log(`Apify run completed with status: ${run.status}`);

      if (run.status !== 'SUCCEEDED') {
        throw new Error(`Apify run failed with status: ${run.status}`);
      }

      const { items } = await this.indeedApifyClient.dataset(run.defaultDatasetId).listItems();

      this.logger.log(`Retrieved ${items.length} jobs from Apify Indeed scraper`);
      this.logger.debug('Sample Apify job data:', items);

      for (const apifyJob of items) {
        try {
          const jobData = {
            title: apifyJob.positionName || apifyJob.title || 'No title',
            company: apifyJob.company || 'Unknown company',
            location: apifyJob.location || 'Not specified',
            salary: apifyJob.salary || 'Not specified',
            jobUrl: apifyJob.url || '',
            datePosted: this.parseApifyDate(String(apifyJob.postedAt || apifyJob.postingDateParsed)) || 'Unknown',
            jobDescription: apifyJob.description || apifyJob.snippet || 'No description available',
            source: 'Linkedin',
            reviewsCount: apifyJob.reviewsCount || null,
          };

          const cleanedJob = this.cleanJobData(jobData);

          if (this.validateJobData(cleanedJob)) {
            if (this.isApifyJobFromToday(apifyJob)) {
              await this.storeJob(cleanedJob);
              this.logger.log(`Saved job: ${cleanedJob.title} at ${cleanedJob.company}`);
            } else {
              this.logger.debug(`Skipping older job: ${cleanedJob.title} (posted: ${apifyJob.postedAt})`);
            }
          } else {
            this.logger.warn('Job failed validation:', {
              title: cleanedJob.title,
              company: cleanedJob.company,
              url: cleanedJob.jobUrl
            });
          }

          await this.randomDelay(500, 1000);

        } catch (jobError) {
          this.logger.error(`Error processing Apify job: ${jobError.message}`, {
            job: apifyJob.positionName || 'Unknown'
          });
        }
      }

    } catch (error) {
      this.logger.error('Apify Indeed scraping failed:', error.message);

      if (error.type === 'ACTOR_RUN_FAILED') {
        this.logger.error('Actor run details:', {
          status: error.run?.status,
          statusMessage: error.run?.statusMessage,
          stats: error.run?.stats
        });
      }
    }
  }

  private async scrapeLinkedInViaApify(): Promise<void> {
    if (!this.LINKEDIN_APIFY_API_TOKEN) {
      this.logger.warn('Apify API token not configured - skipping Linkedin scraping');
      return;
    }

    try {
      this.logger.log('Starting Linkedin scraping via Apify');

      const input = {
        keyword: [this.JOB_TITLE],
        location: 'United States',
        publishedAt: ""
      };

      this.logger.log('Launching Apify Linkedin scraper...');
      const run = await this.linkedInApifyClient.actor(this.LINKEDIN_ACTOR_ID).call(input);

      this.logger.log(`Apify run completed with status: ${run.status}`);

      if (run.status !== 'SUCCEEDED') {
        throw new Error(`Apify run failed with status: ${run.status}`);
      }

      const { items } = await this.linkedInApifyClient.dataset(run.defaultDatasetId).listItems();

      this.logger.log(`Retrieved ${items.length} jobs from Apify Linkedin scraper`);
      this.logger.debug('Sample Apify job data:', items);

      for (const apifyJob of items) {
        try {
          const jobData = {
            title: apifyJob.jobTitle || apifyJob.jobTitle || 'No title',
            company: apifyJob.companyName || 'Unknown company',
            location: apifyJob.location || 'Not specified',
            salary: apifyJob.salaryInfo ? apifyJob.salaryInfo[1] : 'Not specified',
            jobUrl: apifyJob.jobUrl || '',
            datePosted: apifyJob.postedTime,
            description: apifyJob.description || apifyJob.snippet || 'No description available',
            source: 'Linkedin',
            rating: apifyJob.rating || null,
            reviewsCount: apifyJob.reviewsCount || null,
            jobType: Array.isArray(apifyJob.jobType) ? apifyJob.jobType.join(', ') : apifyJob.jobType || 'Not specified'
          };

          const cleanedJob = this.cleanJobData(jobData);

          if (this.validateJobData(cleanedJob)) {
            if (this.isApifyJobFromToday(apifyJob)) {
              await this.storeJob(cleanedJob);
              this.logger.log(`Saved job: ${cleanedJob.title} at ${cleanedJob.company}`);
            } else {
              this.logger.debug(`Skipping older job: ${cleanedJob.title} (posted: ${apifyJob.postedAt})`);
            }
          } else {
            this.logger.warn('Job failed validation:', {
              title: cleanedJob.title,
              company: cleanedJob.company,
              url: cleanedJob.jobUrl
            });
          }

          await this.randomDelay(500, 1000);

        } catch (jobError) {
          this.logger.error(`Error processing Apify job: ${jobError.message}`, {
            job: apifyJob.positionName || 'Unknown'
          });
        }
      }

    } catch (error) {
      this.logger.error('Apify Linkedin scraping failed:', error.message);

      if (error.type === 'ACTOR_RUN_FAILED') {
        this.logger.error('Actor run details:', {
          status: error.run?.status,
          statusMessage: error.run?.statusMessage,
          stats: error.run?.stats
        });
      }
    }
  }

  private isApifyJobFromToday(apifyJob: any): boolean {
    if (apifyJob.postedAt) {
      const postedAt = apifyJob.postedAt.toLowerCase();
      if (postedAt.includes('just posted') || postedAt.includes('today')) {
        return true;
      }

      if (postedAt.match(/\d+\s*hours?\s*ago/i)) {
        return true;
      }

      if (postedAt.includes('1 day ago') || postedAt.includes('yesterday')) {
        return true;
      }
    }

    if (apifyJob.postedTime) {
      const postedAt = apifyJob.postedTime.toLowerCase();
      if (postedAt.includes('just posted') || postedAt.includes('today')) {
        return true;
      }

      if (postedAt.match(/\d+\s*hours?\s*ago/i)) {
        return true;
      }

      if (postedAt.includes('1 day ago') || postedAt.includes('yesterday')) {
        return true;
      }
    }

    if (apifyJob.postingDateParsed) {
      try {
        const postingDate = new Date(apifyJob.postingDateParsed);
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);

        return postingDate >= yesterday;
      } catch (e) {
      }
    }

    if (apifyJob.scrapedAt) {
      try {
        const scrapedDate = new Date(apifyJob.scrapedAt);
        const now = new Date();
        const diffHours = Math.abs(now.getTime() - scrapedDate.getTime()) / (1000 * 60 * 60);

        return diffHours <= 24;
      } catch (e) {
      }
    }

    return false;
  }

  private parseApifyDate(dateValue: string | Date): string {
    if (!dateValue) return 'Unknown';

    if (typeof dateValue === 'string') {
      const dateString = dateValue.toLowerCase();

      if (dateString.includes('just posted') || dateString.includes('today')) {
        return '0d';
      }

      if (dateString.includes('yesterday')) {
        return '1d';
      }

      const dayMatch = dateString.match(/(\d+)\s*days?\s*ago/i);
      if (dayMatch) {
        return `${dayMatch[1]}d`;
      }

      const hourMatch = dateString.match(/(\d+)\s*hours?\s*ago/i);
      if (hourMatch) {
        return `${hourMatch[1]}h`;
      }

      const minuteMatch = dateString.match(/(\d+)\s*minutes?\s*ago/i);
      if (minuteMatch) {
        return `${minuteMatch[1]}m`;
      }
    }

    try {
      const date = new Date(dateValue);
      if (isValid(date)) {
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - date.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return '0d';
        if (diffDays === 1) return '1d';
        return `${diffDays}d`;
      }
    } catch (e) {
    }

    return String(dateValue);
  }

  private async simulateHumanBehavior(page: any): Promise<void> {
    await page.evaluate(async () => {
      for (let i = 0; i < 7; i++) {
        window.scrollBy(0, Math.floor(Math.random() * 500) + 100)
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500))
      }
    });

    await page.mouse.move(
      Math.floor(Math.random() * 500),
      Math.floor(Math.random() * 500)
    )

    await page.mouse.move(200, 200, { steps: 10 });

    if (Math.random() > 0.6) {
      await page.mouse.click(
        Math.floor(Math.random() * 800),
        Math.floor(Math.random() * 600)
      );
    }

    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy({
          top: Math.floor(Math.random() * 500) + 100,
          behavior: Math.random() > 0.5 ? 'smooth' : 'auto'
        });
        await new Promise(resolve =>
          setTimeout(resolve, Math.random() * 3000 + 1000)
        );
      }
    });
  }

  private async checkBrowserHealth(browser: any): Promise<boolean> {
    try {
      const page = await browser.newPage();
      try {
        await page.goto('about:blank', { timeout: 30000 });
        return true;
      } finally {
        await page.close();
      }
    } catch (err) {
      this.logger.error('Browser health check failed:', err);
      return false;
    }
  }

  private async storeJob(job: any): Promise<void> {
    const storageHost = this.configService.get<string>('STORAGE_SERVICE_HOST');
    const saveJobsApiEndpoint = `${storageHost}/jobs/save`;

    try {
      const cleanedJob = this.cleanJobData(job);

      if (!this.validateJobData(cleanedJob)) {
        this.logger.warn('Job validation failed, skipping save:', {
          title: cleanedJob.title,
          company: cleanedJob.company,
          url: cleanedJob.jobUrl
        });
        return;
      }

      this.logger.log("Saving validated job:", cleanedJob.title);

      let revenue = 'Unknown';
      let industry = 'Unknown';
      if (cleanedJob.company && cleanedJob.company !== 'Unknown company') {
        revenue = await this.getCompanyRevenue(cleanedJob.company);
        const industryInfo = await this.getCompanyIndustry(cleanedJob.company);
        industry = industryInfo && typeof industryInfo === 'object' && industryInfo.industry
          ? industryInfo.industry
          : 'Unknown';
      }

      const jobData = {
        title: cleanedJob.title,
        company: cleanedJob.company,
        location: cleanedJob.location,
        salary: cleanedJob.salary,
        datePosted: cleanedJob.datePosted,
        jobUrl: cleanedJob.jobUrl,
        description: cleanedJob.description,
        source: cleanedJob.source,
        revenue,
        industry,
        searchvector: `${cleanedJob.title} ${cleanedJob.company} ${cleanedJob.description} ${cleanedJob.salary} ${cleanedJob.location} ${cleanedJob.datePosted}`.trim()
      };

      this.logger.debug('Job data being sent to storage service:', {
        title: jobData.title,
        company: jobData.company,
        jobUrl: jobData.jobUrl,
        allKeys: Object.keys(jobData),
        dataTypes: {
          title: typeof jobData.title,
          company: typeof jobData.company,
          jobUrl: typeof jobData.jobUrl
        }
      });

      const response = await firstValueFrom(
        this.httpService.post(saveJobsApiEndpoint, jobData, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          timeout: 30000,
          transformRequest: [(data) => {
            this.logger.debug('Transforming request data:', Object.keys(data));
            return JSON.stringify(data);
          }],
        })
      );

      this.logger.log(`Successfully saved job: ${cleanedJob.title} at ${cleanedJob.company}`);
      this.logger.debug('Storage service response status:', response.status);

    } catch (error) {
      if (this.abortController.signal.aborted) {
        this.logger.log('Job save aborted');
      } else {
        this.logger.error('Error saving job:', error);
        this.logger.error('Request details:', {
          url: saveJobsApiEndpoint,
          method: 'POST',
          headers: error.config?.headers,
        });

        if (error.response) {
          this.logger.error('HTTP Error Response:', {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
            headers: error.response.headers
          });
        }

        if (error.request) {
          this.logger.error('HTTP Request that failed:', {
            method: error.request.method,
            path: error.request.path,
            headers: error.request._header
          });
        }
      }
    }
  }

  private async onScrapeComplete(): Promise<void> {
    this.logger.log('Scraping completed successfully');
    const searchHost = this.configService.get<string>('SEARCH_SERVICE_HOST');
    const processNewJobsAlertApiEndpoint = `${searchHost}/jobs/process-new-jobs-alert`;

    try {
      // await firstValueFrom(this.httpService.post(processNewJobsAlertApiEndpoint));
      this.logger.log('New jobs processed successfully');
    } catch (error) {
      this.logger.error('Error processing alert new jobs', error);
    }
  }

  public async getCompanyRevenue(companyName: string): Promise<string> {
    if (!this.SERPER_API_KEY) {
      this.logger.warn('Serper API key not configured - skipping revenue lookup');
      return 'Unknown (API not configured)';
    }

    try {
      const query = `site:zoominfo.com ${companyName} revenue`;
      const response = await firstValueFrom(
        this.httpService.post(
          this.SERPER_API_ENDPOINT,
          { q: query },
          { headers: { 'X-API-KEY': this.SERPER_API_KEY } }
        )
      );

      const results = response.data.organic;
      if (!results || results.length === 0) {
        return 'Unknown (no ZoomInfo results)';
      }

      const zoominfoResult = results.find(r =>
        r.link.includes('zoominfo.com') &&
        (r.link.includes('/c/') || r.link.includes('/company/'))
      );

      if (!zoominfoResult) {
        return 'Unknown (no matching ZoomInfo page)';
      }

      console.log('ZoomInfo Result:', zoominfoResult);

      const snippet = zoominfoResult.snippet || '';
      this.logger.debug(`Revenue search snippet for ${companyName}:`, snippet);

      const revenueFromSnippet = this.extractRevenue(snippet);
      if (revenueFromSnippet) {
        this.logger.debug(`Revenue found in snippet: ${revenueFromSnippet}`);
        return revenueFromSnippet;
      }

      this.logger.debug(`No revenue in snippet, trying alternative search approaches`);

      const alternativeQueries = [
        `site:zoominfo.com "${companyName}" annual revenue`,
        `site:zoominfo.com "${companyName}" "million" OR "billion"`,
        `"${companyName}" revenue site:zoominfo.com financial`,
        `${companyName} zoominfo.com revenue 2024 2023`
      ];

      for (const altQuery of alternativeQueries) {
        try {
          this.logger.debug(`Trying alternative query: ${altQuery}`);

          const altResponse = await firstValueFrom(
            this.httpService.post(
              this.SERPER_API_ENDPOINT,
              { q: altQuery },
              { headers: { 'X-API-KEY': this.SERPER_API_KEY } }
            )
          );

          const altResults = altResponse.data.organic;
          if (altResults && altResults.length > 0) {
            for (const result of altResults.slice(0, 3)) {
              if (result.link.includes('zoominfo.com')) {
                const revenueFromAltSnippet = this.extractRevenue(result.snippet || '');
                if (revenueFromAltSnippet) {
                  this.logger.debug(`Revenue found in alternative search: ${revenueFromAltSnippet}`);
                  return revenueFromAltSnippet;
                }
              }
            }
          }

          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (altError) {
          this.logger.debug(`Alternative query failed: ${altError.message}`);
          continue;
        }
      }

      try {
        this.logger.debug(`Trying broader search without site restriction`);

        const broadQuery = `"${companyName}" revenue "million" OR "billion" zoominfo`;
        const broadResponse = await firstValueFrom(
          this.httpService.post(
            this.SERPER_API_ENDPOINT,
            { q: broadQuery },
            { headers: { 'X-API-KEY': this.SERPER_API_KEY } }
          )
        );

        const broadResults = broadResponse.data.organic;
        if (broadResults && broadResults.length > 0) {
          for (const result of broadResults.slice(0, 5)) {
            if (result.link.includes('zoominfo.com')) {
              const revenueFromBroad = this.extractRevenue(result.snippet || '');
              if (revenueFromBroad) {
                this.logger.debug(`Revenue found in broader search: ${revenueFromBroad}`);
                return revenueFromBroad;
              }
            }
          }
        }
      } catch (broadError) {
        this.logger.debug(`Broader search failed: ${broadError.message}`);
      }

      return 'Unknown (revenue not found)';
    } catch (error) {
      this.logger.error(`Error fetching company revenue for ${companyName}:`, error.message);
      throw new Error(error)
    }
  }

  private extractRevenue(text: string): string | null {
    const revenuePatterns = [
      /\$(\d+(?:\.\d+)?(?:,\d{3})*)\s+(billion|million|B|M)\b/i,
      /revenue\s+is\s+\$(\d+(?:\.\d+)?(?:,\d{3})*)\s+(billion|million|B|M)\b/i,
      /(?:revenue|sales|annual revenue|total revenue)(?:\s+is|\s+of|\s*:)?\s*(?:about|approximately|~)?\s*\$(\d+(?:\.\d+)?(?:,\d{3})*)\s+(billion|million|B|M)\b/i,
      /\$(\d+(?:\.\d+)?(?:,\d{3})*)\s+(?:in\s+)?(billion|million|B|M)\b/i,
      /\$(\d+(?:\.\d+)?(?:,\d{3})*)\b/
    ];

    let revenueMatch: RegExpMatchArray | null = null;
    let matchedUnit: string | undefined = undefined;

    for (const pattern of revenuePatterns) {
      revenueMatch = text.match(pattern);
      if (revenueMatch) {
        matchedUnit = revenueMatch[2];
        break;
      }
    }

    if (revenueMatch) {
      let amount = String(revenueMatch[1]).replace(/,/g, '');
      let suffix = '';

      if (matchedUnit && typeof matchedUnit === 'string') {
        const unit = matchedUnit.toLowerCase();
        if (unit.includes('million') || unit === 'm') {
          suffix = 'M';
        } else if (unit.includes('billion') || unit === 'b') {
          suffix = 'B';
        }
      } else {
        if (text.toLowerCase().includes('billion')) {
          suffix = 'B';
        } else if (text.toLowerCase().includes('million')) {
          suffix = 'M';
        }
      }
      if (amount.includes('.')) {
        amount = parseFloat(amount).toString();
      }
      if (suffix) {
        return `~${amount}${suffix}`;
      }
      return `~${amount}`;
    }
    return null;
  }

  public async getCompanyIndustry(companyName: string): Promise<CompanyIndustryInfo | null> {

    try {
      const results = await this.companyIndustryService.getCompanyIndustry(companyName);
      console.log('Comprehensive Industry Results:', results);
      return results;
    } catch (error) {
      console.error(`Error in comprehensive search for ${companyName}:`, error);
      return null;
    }
  }
}