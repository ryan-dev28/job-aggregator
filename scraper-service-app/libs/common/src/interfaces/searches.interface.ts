export interface Search {
    id: number;
    user: number;
    name: string;
    title?: string;
    location?: string;
    keywords?: string;
    datePosted?: string;
    salary?: string;
    createdAt: Date;
}