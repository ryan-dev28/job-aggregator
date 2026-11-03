import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface SerperResponse {
    organic?: Array<{
        title: string;
        snippet: string;
        link: string;
    }>;
    knowledgeGraph?: {
        title: string;
        type: string;
        description: string;
        attributes?: Record<string, string>;
    };
    answerBox?: {
        answer: string;
        snippet: string;
    };
}

interface CompanyIndustryInfo {
    company: string;
    industry: string | null;
    sector: string | null;
    description: string | null;
    confidence: 'high' | 'medium' | 'low';
    source: string;
    rawText?: string; // For debugging
}

interface IndustryExtractionConfig {
    maxLength?: number;
    minLength?: number;
    allowedSources?: string[];
    strictMode?: boolean;
    debug?: boolean;
    customPatterns?: RegExp[];
    excludeWords?: string[];
    industryKeywords?: string[];
}

@Injectable()
export class CompanyIndustryService {
    private readonly logger = new Logger(CompanyIndustryService.name);
    private readonly SERPER_API_KEY: string;
    private readonly SERPER_URL = 'https://google.serper.dev/search';
    private config: IndustryExtractionConfig;

    // Enhanced industry keywords that include service industries
    private readonly COMMON_INDUSTRIES = [
        'healthcare', 'health care', 'hospitals and health care', 'medical', 'pharmaceutical', 'biotechnology',
        'technology', 'information technology', 'software', 'artificial intelligence', 'machine learning',
        'finance', 'financial services', 'banking', 'insurance', 'investment',
        'retail', 'e-commerce', 'consumer goods', 'fashion', 'beauty',
        'manufacturing', 'automotive', 'aerospace', 'industrial',
        'construction', 'real estate', 'architecture',
        'education', 'training', 'research',
        'consulting', 'management consulting', 'business consulting', 'professional services',
        'staffing and recruiting', 'human resources', 'employment services', 'talent acquisition',
        'business services', 'outsourcing', 'facility services', 'administrative services',
        'media', 'entertainment', 'advertising', 'marketing',
        'telecommunications', 'internet', 'networking',
        'energy', 'oil and gas', 'renewable energy', 'utilities',
        'transportation', 'logistics', 'supply chain', 'shipping',
        'hospitality', 'tourism', 'restaurants', 'food and beverage',
        'agriculture', 'farming', 'mining',
        'government', 'non-profit', 'legal services', 'accounting',
        'cybersecurity', 'cloud computing', 'data analytics', 'gaming'
    ];

    private readonly DEFAULT_CONFIG: IndustryExtractionConfig = {
        maxLength: 60,
        minLength: 5,
        allowedSources: ['linkedin.com', 'wikipedia.org', 'crunchbase.com', 'bloomberg.com', 'reuters.com'],
        strictMode: false,
        debug: false,
        excludeWords: [
            'mission', 'workplace', 'community', 'patients', 'first', 'overview', 'about',
            'civic', 'social organizations' // Only exclude clearly wrong classifications
        ],
        industryKeywords: this.COMMON_INDUSTRIES
    };

    constructor(private readonly configService: ConfigService) {
        this.SERPER_API_KEY = this.configService.get<string>('SERPER_API_KEY') ?? '';
        this.config = { ...this.DEFAULT_CONFIG };

        if (!this.SERPER_API_KEY) {
            this.logger.warn('SERPER_API_KEY not found in environment variables');
        }
    }

    // Update configuration at runtime
    updateConfig(newConfig: Partial<IndustryExtractionConfig>): void {
        this.config = { ...this.config, ...newConfig };
        this.logger.log('Industry extraction configuration updated');
    }

    async getMoreSpecificIndustry(companyName: string, genericIndustry: string): Promise<string | null> {
        this.logger.debug(`Attempting to find more specific industry for ${companyName} (currently: ${genericIndustry})`);

        // Try more targeted searches
        const specificQueries = [
            `"${companyName}" what does company do business`,
            `"${companyName}" specializes products services`,
            `"${companyName}" industry sector NOT staffing NOT recruiting`,
            `"${companyName}" business type focus area`
        ];

        for (const query of specificQueries) {
            try {
                const response = await this.makeSerperRequest(query, 5);
                const result = this.extractFromGeneral(companyName, response);

                if (result && result.industry && result.industry !== genericIndustry) {
                    // Score the new result to see if it's better
                    const newScore = this.scoreIndustry(result.industry);
                    const oldScore = this.scoreIndustry(genericIndustry);

                    if (newScore > oldScore + 2) { // Require significantly better score
                        this.logger.log(`Found more specific industry: ${result.industry} (score: ${newScore} vs ${oldScore})`);
                        return result.industry;
                    }
                }

                await this.delay(300); // Longer delay for follow-up searches
            } catch (error) {
                this.logger.error(`Specific industry search failed for query: ${query}`, error.message);
                continue;
            }
        }

        return null;
    }

    // Enhanced main method that tries to get more specific results
    async getCompanyIndustry(companyName: string, customConfig?: Partial<IndustryExtractionConfig>): Promise<CompanyIndustryInfo | null> {
        if (!this.SERPER_API_KEY) {
            this.logger.error('Cannot perform industry lookup: SERPER_API_KEY not configured');
            return null;
        }

        const searchConfig = { ...this.config, ...customConfig };

        if (searchConfig.debug) {
            this.logger.debug(`Starting industry lookup for: ${companyName}`);
        }

        const searchStrategies = [
            () => this.searchKnowledgeGraph(companyName),
            () => this.searchLinkedIn(companyName),
            () => this.searchWikipediaCrunchbase(companyName),
            () => this.searchGeneral(companyName),
            () => this.searchWithIndustryKeywords(companyName)
        ];

        const results: CompanyIndustryInfo[] = [];

        for (const [index, strategy] of searchStrategies.entries()) {
            try {
                const result = await strategy();
                if (result && this.isValidResult(result, searchConfig)) {
                    results.push(result);

                    if (searchConfig.debug) {
                        this.logger.debug(`Strategy ${index + 1} result:`, {
                            source: result.source,
                            industry: result.industry,
                            confidence: result.confidence,
                            score: this.scoreIndustry(result.industry || '')
                        });
                    }

                    // If we found a high confidence result and not in debug mode, we can return early
                    // But only if it's not a generic industry
                    if (result.confidence === 'high' && !searchConfig.debug && this.scoreIndustry(result.industry || '') > 3) {
                        this.logger.log(`High confidence industry found for ${companyName}: ${result.industry}`);
                        return result;
                    }
                }

                // Add delay between requests to respect rate limits
                await this.delay(200);
            } catch (error) {
                if (searchConfig.debug) {
                    this.logger.error(`Strategy ${index + 1} failed:`, error.message);
                }
            }
        }

        if (results.length === 0) {
            this.logger.warn(`No industry information found for: ${companyName}`);
            return null;
        }

        const bestResult = this.selectBestResult(results, searchConfig);

        // If the best result is still generic/low-scoring, try to find something more specific
        if (this.scoreIndustry(bestResult.industry || '') < 2) {
            this.logger.debug(`Industry result seems generic for ${companyName}: ${bestResult.industry}`);

            const moreSpecific = await this.getMoreSpecificIndustry(companyName, bestResult.industry || '');
            if (moreSpecific) {
                bestResult.industry = moreSpecific;
                bestResult.confidence = 'medium';
                bestResult.source = bestResult.source + ' (refined)';
            }
        }

        this.logger.log(`Industry found for ${companyName}: ${bestResult.industry} (${bestResult.source})`);
        return bestResult;
    }

    private async searchKnowledgeGraph(companyName: string): Promise<CompanyIndustryInfo | null> {
        const queries = [
            `${companyName} company`,
            `"${companyName}" corporation`,
            `${companyName} business`
        ];

        for (const query of queries) {
            try {
                const response = await this.makeSerperRequest(query, 1);
                const result = this.extractFromKnowledgeGraph(companyName, response);
                if (result) return result;
            } catch (error) {
                this.logger.error(`Knowledge Graph search failed for query: ${query}`, error.message);
                continue;
            }
        }

        return null;
    }

    private async searchLinkedIn(companyName: string): Promise<CompanyIndustryInfo | null> {
        const queries = [
            `site:linkedin.com/company "${companyName}"`,
            `site:linkedin.com "${companyName}" industry`,
            `linkedin.com "${companyName}" company`
        ];

        for (const query of queries) {
            try {
                const response = await this.makeSerperRequest(query, 3);
                const result = this.extractFromLinkedIn(companyName, response);
                if (result) return result;
            } catch (error) {
                this.logger.error(`LinkedIn search failed for query: ${query}`, error.message);
                continue;
            }
        }

        return null;
    }

    private async searchWikipediaCrunchbase(companyName: string): Promise<CompanyIndustryInfo | null> {
        const queries = [
            `"${companyName}" site:wikipedia.org industry`,
            `"${companyName}" site:crunchbase.com`,
            `"${companyName}" wikipedia company`
        ];

        for (const query of queries) {
            try {
                const response = await this.makeSerperRequest(query, 2);
                const result = this.extractFromWikiCrunchbase(companyName, response);
                if (result) return result;
            } catch (error) {
                this.logger.error(`Wiki/Crunchbase search failed for query: ${query}`, error.message);
                continue;
            }
        }

        return null;
    }

    private async searchGeneral(companyName: string): Promise<CompanyIndustryInfo | null> {
        const queries = [
            `"${companyName}" company industry sector`,
            `"${companyName}" business type industry`,
            `what does "${companyName}" do business`
        ];

        for (const query of queries) {
            try {
                const response = await this.makeSerperRequest(query, 5);
                const result = this.extractFromGeneral(companyName, response);
                if (result) return result;
            } catch (error) {
                this.logger.error(`General search failed for query: ${query}`, error.message);
                continue;
            }
        }

        return null;
    }

    private async searchWithIndustryKeywords(companyName: string): Promise<CompanyIndustryInfo | null> {
        // Try searching with specific industry keywords if we have hints
        const possibleIndustries = this.guessPossibleIndustries(companyName);

        for (const industry of possibleIndustries.slice(0, 3)) {
            try {
                const query = `"${companyName}" "${industry}" company`;
                const response = await this.makeSerperRequest(query, 3);
                const result = this.extractFromGeneral(companyName, response);
                if (result) return result;
            } catch (error) {
                this.logger.error(`Industry keyword search failed for: ${industry}`, error.message);
                continue;
            }
        }

        return null;
    }

    private async makeSerperRequest(query: string, num: number = 5): Promise<SerperResponse> {
        try {
            const response = await axios.post(
                this.SERPER_URL,
                {
                    q: query,
                    num: num
                },
                {
                    headers: {
                        'X-API-KEY': this.SERPER_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000 // 10 second timeout
                }
            );

            return response.data;
        } catch (error) {
            if (error.response?.status === 429) {
                this.logger.warn('Serper API rate limit reached');
                throw new Error('Rate limit exceeded');
            }

            this.logger.error('Serper API request failed:', error.message);
            throw error;
        }
    }

    private extractFromKnowledgeGraph(companyName: string, data: SerperResponse): CompanyIndustryInfo | null {
        if (!data.knowledgeGraph) return null;

        const kg = data.knowledgeGraph;
        const possibleIndustries = [
            kg.attributes?.Industry,
            kg.attributes?.Sector,
            kg.attributes?.Type,
            kg.type,
            this.extractIndustryFromText(kg.description, 'knowledge_graph')
        ].filter((item): item is string => typeof item === 'string' && !!item);

        const industry = this.selectBestIndustryFromOptions(possibleIndustries);

        if (industry) {
            return {
                company: companyName,
                industry: industry,
                sector: kg.attributes?.Sector || null,
                description: kg.description,
                confidence: 'high',
                source: 'Knowledge Graph',
                rawText: this.config.debug ? JSON.stringify(kg.attributes) : undefined
            };
        }

        return null;
    }

    private extractFromLinkedIn(companyName: string, data: SerperResponse): CompanyIndustryInfo | null {
        if (!data.organic || data.organic.length === 0) return null;

        for (const result of data.organic) {
            if (!result.link.includes('linkedin.com')) continue;

            const extractedIndustries = this.extractAllPossibleIndustries(result.snippet, 'linkedin');
            const industry = this.selectBestIndustryFromOptions(extractedIndustries);

            if (industry) {
                return {
                    company: companyName,
                    industry: industry,
                    sector: null,
                    description: result.snippet,
                    confidence: 'high',
                    source: 'LinkedIn',
                    rawText: this.config.debug ? result.snippet : undefined
                };
            }
        }

        return null;
    }

    private extractFromWikiCrunchbase(companyName: string, data: SerperResponse): CompanyIndustryInfo | null {
        if (!data.organic || data.organic.length === 0) return null;

        for (const result of data.organic) {
            const isWiki = result.link.includes('wikipedia.org');
            const isCrunchbase = result.link.includes('crunchbase.com');

            if (!isWiki && !isCrunchbase) continue;

            const sourceType = isWiki ? 'wikipedia' : 'crunchbase';
            const extractedIndustries = this.extractAllPossibleIndustries(result.snippet, sourceType);
            const industry = this.selectBestIndustryFromOptions(extractedIndustries);

            if (industry) {
                return {
                    company: companyName,
                    industry: industry,
                    sector: null,
                    description: result.snippet,
                    confidence: 'high',
                    source: isWiki ? 'Wikipedia' : 'Crunchbase',
                    rawText: this.config.debug ? result.snippet : undefined
                };
            }
        }

        return null;
    }

    private extractFromGeneral(companyName: string, data: SerperResponse): CompanyIndustryInfo | null {
        // Check answer box first
        if (data.answerBox) {
            const text = `${data.answerBox.answer} ${data.answerBox.snippet}`;
            const extractedIndustries = this.extractAllPossibleIndustries(text, 'answer_box');
            const industry = this.selectBestIndustryFromOptions(extractedIndustries);

            if (industry) {
                return {
                    company: companyName,
                    industry: industry,
                    sector: null,
                    description: data.answerBox.snippet,
                    confidence: 'medium',
                    source: 'Answer Box',
                    rawText: this.config.debug ? text : undefined
                };
            }
        }

        // Check organic results
        if (data.organic && data.organic.length > 0) {
            for (const result of data.organic) {
                const text = `${result.title} ${result.snippet}`;
                const extractedIndustries = this.extractAllPossibleIndustries(text, 'organic');
                const industry = this.selectBestIndustryFromOptions(extractedIndustries);

                if (industry) {
                    return {
                        company: companyName,
                        industry: industry,
                        sector: null,
                        description: result.snippet,
                        confidence: 'medium',
                        source: this.getSourceName(result.link),
                        rawText: this.config.debug ? text : undefined
                    };
                }
            }
        }

        return null;
    }

    private extractAllPossibleIndustries(text: string, sourceType: string): string[] {
        if (!text) return [];

        const cleanText = text.replace(/\s+/g, ' ').trim();
        const industries: string[] = [];

        // Define patterns based on source type
        const patterns = this.getPatternsBySourceType(sourceType);

        // Add custom patterns if provided
        if (this.config.customPatterns) {
            patterns.push(...this.config.customPatterns);
        }

        // Extract using patterns
        for (const pattern of patterns) {
            const matches = cleanText.matchAll(new RegExp(pattern.source, pattern.flags + 'g'));
            for (const match of matches) {
                if (match[1]) {
                    const cleaned = this.cleanIndustryText(match[1]);
                    if (cleaned && this.isValidIndustryText(cleaned)) {
                        industries.push(cleaned);
                    }
                }
            }
        }

        // Extract known industry keywords
        const keywordMatches = this.extractKnownIndustries(cleanText);
        industries.push(...keywordMatches);

        return [...new Set(industries)]; // Remove duplicates
    }

    private getPatternsBySourceType(sourceType: string): RegExp[] {
        const basePatterns = [
            /industry[:\s]+([^•.,\n]{3,60}?)(?:[•.,\n]|$)/i,
            /sector[:\s]+([^•.,\n]{3,60}?)(?:[•.,\n]|$)/i,
            /specializes in[:\s]+([^•.,\n]{3,60}?)(?:[•.,\n]|$)/i,
            /operates in[:\s]+([^•.,\n]{3,60}?)(?:[•.,\n]|$)/i
        ];

        switch (sourceType) {
            case 'linkedin':
                return [
                    // LinkedIn specific patterns
                    /^([^•.,\n]{5,60}?)(?:\s*[•.]\s*(?:Company size|employees|\d+))/i,
                    /Industry[:\s]*([^•.,\n]{3,60}?)(?:[•.,\n]|Company size|employees)/i,
                    /([^•\n]{10,60}?)\s*•\s*(?:Company size|\d+[,\s]*employees)/i,
                    ...basePatterns
                ];

            case 'wikipedia':
                return [
                    /is a[n]?\s+([^•.,\n]{5,60}?)\s+(?:company|corporation|business)/i,
                    /([^•.,\n]{5,60}?)\s+(?:company|corporation|business)/i,
                    ...basePatterns
                ];

            case 'crunchbase':
                return [
                    /Category[:\s]+([^•.,\n]{3,60}?)(?:[•.,\n]|$)/i,
                    /Categories[:\s]+([^•.,\n]{3,60}?)(?:[•.,\n]|$)/i,
                    ...basePatterns
                ];

            default:
                return basePatterns;
        }
    }

    private extractKnownIndustries(text: string): string[] {
        const found: string[] = [];
        const lowerText = text.toLowerCase();

        for (const industry of this.config.industryKeywords || []) {
            const industryLower = industry.toLowerCase();
            if (lowerText.includes(industryLower)) {
                // Check if it's a whole word match or part of a phrase
                const regex = new RegExp(`\\b${industryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                if (regex.test(text)) {
                    found.push(this.capitalizeIndustry(industry));
                }
            }
        }

        return found;
    }

    private extractIndustryFromText(text: string, sourceType: string): string | null {
        if (!text) return null;
        const industries = this.extractAllPossibleIndustries(text, sourceType);
        return this.selectBestIndustryFromOptions(industries);
    }

    private selectBestIndustryFromOptions(industries: string[]): string | null {
        if (!industries || industries.length === 0) return null;

        // Score industries based on various factors
        const scoredIndustries = industries.map(industry => ({
            industry,
            score: this.scoreIndustry(industry)
        }));

        // Sort by score and return the best one
        scoredIndustries.sort((a, b) => b.score - a.score);

        const best = scoredIndustries[0];
        return best && best.score > 0 ? best.industry : null;
    }

    private scoreIndustry(industry: string): number {
        let score = 0;
        const lowerIndustry = industry.toLowerCase();

        // Length scoring (prefer moderate lengths)
        if (industry.length >= 5 && industry.length <= 50) score += 2;
        if (industry.length >= 10 && industry.length <= 30) score += 1;

        // Check if this might be a legitimate staffing/recruiting company
        const isLikelyStaffingCompany = this.isLikelyStaffingCompany(industry);

        // Penalty for overly generic industries (but not for legitimate staffing companies)
        const genericIndustries = [
            'civic and social organizations',
            'other',
            'general',
            'services', // just "services" alone
            'company',
            'corporation',
            'organization',
            'management', // just "management" alone
            'administration',
            'operations'
        ];

        const isGeneric = genericIndustries.some(generic =>
            lowerIndustry === generic.toLowerCase()
        );
        if (isGeneric) score -= 5;

        // More nuanced handling of staffing/recruiting terms
        if (lowerIndustry.includes('staffing') || lowerIndustry.includes('recruiting')) {
            if (isLikelyStaffingCompany) {
                score += 1;
            } else {
                score -= 3;
            }
        }

        // Handle "business services" more carefully
        if (lowerIndustry.includes('business services')) {
            if (isLikelyStaffingCompany || this.isLikelyBusinessServices(industry)) {
                score += 0; // Neutral - could be correct
            } else {
                score -= 2; // Slight penalty if seems too generic
            }
        }

        // Penalty for organizational structure terms (not actual industries)
        const organizationalTerms = ['civic', 'social organizations', 'non-profit', 'government', 'public'];
        const isOrganizational = organizationalTerms.some(term => lowerIndustry.includes(term));
        if (isOrganizational) score -= 4;

        // Bonus for specific, concrete industries
        const specificIndustries = [
            'healthcare', 'hospitals and health care', 'medical', 'pharmaceutical', 'biotechnology',
            'software', 'technology', 'information technology', 'artificial intelligence',
            'finance', 'banking', 'insurance', 'financial services',
            'manufacturing', 'automotive', 'aerospace', 'construction',
            'retail', 'e-commerce', 'fashion', 'food and beverage',
            'telecommunications', 'energy', 'oil and gas', 'utilities',
            'real estate', 'media', 'entertainment', 'education',
            'logistics', 'transportation', 'agriculture', 'mining',
            // Include legitimate service industries
            'staffing and recruiting', 'human resources', 'business services',
            'management consulting', 'professional services'
        ];

        const isSpecific = specificIndustries.some(specific =>
            lowerIndustry === specific.toLowerCase() ||
            (lowerIndustry.includes(specific.toLowerCase()) && specific.length > 8)
        );
        if (isSpecific) score += 3;

        // Known industry bonus (but not if it's generic)
        const isKnownIndustry = this.config.industryKeywords?.some(known =>
            known.toLowerCase() === industry.toLowerCase()
        );
        if (isKnownIndustry && !isGeneric) score += 2;

        // Partial match with known industries (but not if generic)
        const hasKnownWords = this.config.industryKeywords?.some(known =>
            industry.toLowerCase().includes(known.toLowerCase()) ||
            known.toLowerCase().includes(industry.toLowerCase())
        );
        if (hasKnownWords && !isGeneric) score += 1;

        // Penalty for excluded words (but be more careful)
        const hasExcludedWords = this.config.excludeWords?.some(excluded =>
            industry.toLowerCase().includes(excluded.toLowerCase())
        );
        if (hasExcludedWords && !isLikelyStaffingCompany) score -= 2;

        // Format scoring
        if (/^[A-Z]/.test(industry)) score += 1; // Starts with capital
        if (!/\d{3,}/.test(industry)) score += 1; // No long numbers
        if (!/^[^a-zA-Z]*$/.test(industry)) score += 1; // Contains letters

        // Penalty for trailing punctuation
        if (/[;,.]$/.test(industry)) score -= 1;

        return score;
    }

    // New method to determine if a company is likely in the staffing business
    private isLikelyStaffingCompany(industry: string): boolean {
        const lowerIndustry = industry.toLowerCase();

        // Strong indicators of legitimate staffing companies
        const staffingIndicators = [
            'staffing and recruiting',
            'human resources',
            'employment services',
            'talent acquisition',
            'workforce solutions',
            'temporary staffing',
            'contract staffing',
            'executive search',
            'recruitment services'
        ];

        return staffingIndicators.some(indicator =>
            lowerIndustry.includes(indicator.toLowerCase())
        );
    }

    // New method to determine if "business services" is legitimate
    private isLikelyBusinessServices(industry: string): boolean {
        const lowerIndustry = industry.toLowerCase();

        // Check for specific business services
        const businessServiceTypes = [
            'business services',
            'professional services',
            'consulting services',
            'advisory services',
            'outsourcing services',
            'business process outsourcing',
            'facility services'
        ];

        return businessServiceTypes.some(type =>
            lowerIndustry.includes(type.toLowerCase())
        );
    }

    private cleanIndustryText(text: string): string | null {
        if (!text) return null;

        let cleaned = text.trim();

        // Remove trailing punctuation (semicolons, commas, periods)
        cleaned = cleaned.replace(/[;,.\s]+$/, '');

        // Remove common prefixes and suffixes
        cleaned = cleaned.replace(/^(and|&|,|\.|•|the|a|an)\s*/i, '');
        cleaned = cleaned.replace(/\s*(and|&|,|\.|•|inc|llc|corp|corporation|ltd|company)\.?\s*$/i, '');

        // Remove extra whitespace
        cleaned = cleaned.replace(/\s+/g, ' ').trim();

        // Remove parentheses content that looks like descriptions
        cleaned = cleaned.replace(/\s*\([^)]*\)\s*/g, ' ').trim();

        // Remove trailing "services" if it makes the industry too generic
        if (cleaned.toLowerCase().endsWith(' services') && cleaned.split(' ').length <= 3) {
            const withoutServices = cleaned.replace(/\s+services$/i, '').trim();
            // Only remove "services" if what remains is still meaningful
            if (withoutServices.length >= 5) {
                cleaned = withoutServices;
            }
        }

        return cleaned || null;
    }

    private isValidIndustryText(text: string): boolean {
        if (!text) return false;

        const { minLength = 3, maxLength = 80, excludeWords = [] } = this.config;
        const lowerText = text.toLowerCase();

        // Length check
        if (text.length < minLength || text.length > maxLength) return false;

        // Should contain letters
        if (!/[a-zA-Z]/.test(text)) return false;

        // Should not be just numbers
        if (/^\d+$/.test(text)) return false;

        // Should not contain too much punctuation
        if ((text.match(/[.•,;:]/g) || []).length > text.length / 4) return false;

        // Check for excluded words
        if (excludeWords.some(word => lowerText.includes(word.toLowerCase()))) return false;

        // Be more specific about what we consider problematic
        const definitelyProblematicTerms = [
            'civic and social organizations',
            'other services',
            'general services',
            'unknown',
            'various',
            'multiple industries',
            'diverse',
            'miscellaneous'
        ];

        const isDefinitelyProblematic = definitelyProblematicTerms.some(term =>
            lowerText === term.toLowerCase()
        );

        if (isDefinitelyProblematic) return false;

        // Reject if it's too generic (single common words)
        const tooGenericSingle = ['services', 'company', 'business', 'organization', 'solutions', 'group', 'corporation'];
        if (tooGenericSingle.includes(lowerText)) return false;

        // Accept legitimate service industries
        const legitimateServiceIndustries = [
            'staffing and recruiting',
            'business services',
            'professional services',
            'human resources',
            'employment services',
            'management consulting',
            'financial services',
            'legal services',
            'accounting services',
            'healthcare services',
            'educational services',
            'food services'
        ];

        const isLegitimateService = legitimateServiceIndustries.some(service =>
            lowerText === service.toLowerCase() ||
            (lowerText.includes(service.toLowerCase()) && Math.abs(lowerText.length - service.length) < 10)
        );

        if (isLegitimateService) return true;

        return true;
    }

    private isValidResult(result: CompanyIndustryInfo, config: IndustryExtractionConfig): boolean {
        if (!result.industry) return false;

        if (config.strictMode) {
            // In strict mode, only accept results from allowed sources
            const allowedSources = config.allowedSources || [];
            if (allowedSources.length > 0) {
                const isAllowedSource = allowedSources.some(source =>
                    result.source.toLowerCase().includes(source.toLowerCase()) ||
                    (result.rawText && result.rawText.includes(source))
                );
                if (!isAllowedSource) return false;
            }
        }

        return this.isValidIndustryText(result.industry);
    }

    private guessPossibleIndustries(companyName: string): string[] {
        const name = companyName.toLowerCase();
        const guesses: string[] = [];

        // Simple keyword matching for initial guesses
        const industryHints = {
            'health': ['healthcare', 'health care', 'medical'],
            'medical': ['healthcare', 'medical', 'hospitals and health care'],
            'hospital': ['healthcare', 'hospitals and health care'],
            'tech': ['technology', 'software', 'information technology'],
            'consulting': ['consulting', 'management consulting'],
            'finance': ['finance', 'financial services'],
            'bank': ['banking', 'financial services'],
            'insurance': ['insurance', 'financial services'],
            'retail': ['retail', 'consumer goods'],
            'manufacturing': ['manufacturing', 'industrial']
        };

        for (const [hint, industries] of Object.entries(industryHints)) {
            if (name.includes(hint)) {
                guesses.push(...industries);
            }
        }

        return [...new Set(guesses)];
    }

    private capitalizeIndustry(industry: string): string {
        return industry
            .split(' ')
            .map((word, index) => {
                const lowerWords = ['and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'the', 'a', 'an'];
                if (lowerWords.includes(word.toLowerCase()) && index !== 0) {
                    return word.toLowerCase();
                }
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            })
            .join(' ');
    }

    private getSourceName(url: string): string {
        if (url.includes('linkedin.com')) return 'LinkedIn';
        if (url.includes('wikipedia.org')) return 'Wikipedia';
        if (url.includes('crunchbase.com')) return 'Crunchbase';
        if (url.includes('bloomberg.com')) return 'Bloomberg';
        if (url.includes('reuters.com')) return 'Reuters';

        try {
            const domain = new URL(url).hostname.replace('www.', '');
            return domain.charAt(0).toUpperCase() + domain.slice(1);
        } catch {
            return 'Unknown Source';
        }
    }

    private selectBestResult(results: CompanyIndustryInfo[], config: IndustryExtractionConfig): CompanyIndustryInfo {
        const sourceRanking = {
            'Knowledge Graph': 5,
            'LinkedIn': 4,
            'Wikipedia': 4,
            'Crunchbase': 4,
            'Bloomberg': 3,
            'Reuters': 3,
            'Answer Box': 2
        };

        const confidenceRanking = {
            'high': 3,
            'medium': 2,
            'low': 1
        };

        return results.sort((a, b) => {
            const aScore = (sourceRanking[a.source] || 1) + confidenceRanking[a.confidence] + this.scoreIndustry(a.industry || '');
            const bScore = (sourceRanking[b.source] || 1) + confidenceRanking[b.confidence] + this.scoreIndustry(b.industry || '');
            return bScore - aScore;
        })[0];
    }

    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Convenience methods for different use cases
    async getIndustryQuick(companyName: string): Promise<string | null> {
        const result = await this.getCompanyIndustry(companyName, {
            strictMode: false,
            debug: false
        });
        return result?.industry || null;
    }

    async getIndustryDetailed(companyName: string): Promise<CompanyIndustryInfo | null> {
        return await this.getCompanyIndustry(companyName, {
            strictMode: false,
            debug: true
        });
    }

    async getIndustryStrict(companyName: string): Promise<CompanyIndustryInfo | null> {
        return await this.getCompanyIndustry(companyName, {
            strictMode: true,
            allowedSources: ['linkedin.com', 'wikipedia.org', 'crunchbase.com']
        });
    }

    // Method to enrich job data with industry information
    async enrichJobWithIndustry(job: any): Promise<any> {
        try {
            const industryInfo = await this.getCompanyIndustry(job.company);

            return {
                ...job,
                companyIndustry: industryInfo?.industry || null,
                companySector: industryInfo?.sector || null,
                companyDescription: industryInfo?.description || null,
                industryConfidence: industryInfo?.confidence || null,
                industrySource: industryInfo?.source || null
            };
        } catch (error) {
            this.logger.error(`Failed to enrich job with industry for ${job.company}:`, error.message);
            return {
                ...job,
                companyIndustry: null,
                companySector: null,
                companyDescription: null,
                industryConfidence: null,
                industrySource: null
            };
        }
    }

    // Batch processing method for multiple jobs
    async enrichJobsWithIndustry(jobs: any[], batchSize: number = 5): Promise<any[]> {
        this.logger.log(`Enriching ${jobs.length} jobs with industry information`);

        const enrichedJobs: any[] = [];

        for (let i = 0; i < jobs.length; i += batchSize) {
            const batch = jobs.slice(i, i + batchSize);

            this.logger.debug(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(jobs.length / batchSize)}`);

            const enrichedBatch = await Promise.all(
                batch.map(job => this.enrichJobWithIndustry(job))
            );

            enrichedJobs.push(...enrichedBatch);

            // Add delay between batches to respect rate limits
            if (i + batchSize < jobs.length) {
                await this.delay(1000);
            }
        }

        this.logger.log(`Successfully enriched ${enrichedJobs.length} jobs with industry information`);
        return enrichedJobs;
    }
}