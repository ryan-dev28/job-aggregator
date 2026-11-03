export interface CompanyIndustryInfo {
    company: string;
    industry: string | null;
    sector: string | null;
    description: string | null;
    confidence: 'high' | 'medium' | 'low';
    source: string;
}