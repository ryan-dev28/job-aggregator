import { IsOptional, IsString, IsNumber } from 'class-validator';

export class SearchJobDto {
    @IsOptional()
    @IsString()
    search?: string;

    @IsNumber()
    page: number;

    @IsNumber()
    limit: number;

    @IsOptional()
    @IsString()
    title?: string;

    @IsOptional()
    @IsString()
    keyword?: string;

    @IsOptional()
    @IsString()
    company?: string;

    @IsOptional()
    @IsString()
    comp?: string;

    @IsOptional()
    @IsString()
    location?: string;

    @IsOptional()
    @IsString()
    datePosted?: string;

    @IsOptional()
    @IsString()
    sort?: string

    @IsOptional()
    @IsString()
    revenue?: string

    @IsOptional()
    @IsString()
    industry?: string

    @IsOptional()
    @IsString()
    salaryMin?: string

    @IsOptional()
    @IsString()
    salaryMax?: string
}
