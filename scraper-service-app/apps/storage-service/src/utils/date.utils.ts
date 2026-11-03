export interface JobWithDate {
    datePosted: string | undefined;
    createdAt: string | Date | undefined;
}

export function transformJobDatePosted<T extends { datePosted: string; createdAt: string | Date }>(job: T): T {
    try {
        const createdAt = new Date(job.createdAt);
        const now = new Date();

        const timeSinceScraped = now.getTime() - createdAt.getTime();

        const originalAgeInMs = parseRelativeTimeToMs(job.datePosted);

        const actualJobAge = timeSinceScraped + originalAgeInMs;

        const updatedDatePosted = formatMsToRelativeTime(actualJobAge);

        return {
            ...job,
            datePosted: updatedDatePosted
        };
    } catch (error) {
        console.warn(`Failed to transform datePosted for job:`, error);
        return job;
    }
}

export function parseRelativeTimeToMs(datePosted: string): number {
    const lowerCase = datePosted.toLowerCase().trim();

    if (lowerCase === 'just now') return 0;
    if (lowerCase === 'yesterday') return 24 * 60 * 60 * 1000;

    const patterns = [
        { regex: /^(\d+)\s*h(?:our)?s?(?:\s+ago)?$/i, multiplier: 60 * 60 * 1000 },
        { regex: /^(\d+)\s*d(?:ay)?s?(?:\s+ago)?$/i, multiplier: 24 * 60 * 60 * 1000 },
        { regex: /^(\d+)\s*(?:days?\s+ago)$/i, multiplier: 24 * 60 * 60 * 1000 },
        { regex: /^(\d+)\s*(?:hours?\s+ago)$/i, multiplier: 60 * 60 * 1000 },
        { regex: /^(\d+)\s*(?:months?\s+ago)$/i, multiplier: 30 * 24 * 60 * 60 * 1000 },
        { regex: /^(\d+)\s*(?:weeks?\s+ago)$/i, multiplier: 7 * 24 * 60 * 60 * 1000 },
        { regex: /^(\d+)\s*m(?:in)?(?:ute)?s?(?:\s+ago)?$/i, multiplier: 60 * 1000 },
    ];

    for (const pattern of patterns) {
        const match = lowerCase.match(pattern.regex);
        if (match) {
            const number = parseInt(match[1], 10);
            return number * pattern.multiplier;
        }
    }

    return 0;
}

export function formatMsToRelativeTime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (years >= 1) {
        return years === 1 ? '1 year ago' : `${years} years ago`;
    } else if (months >= 1) {
        return months === 1 ? '1 month ago' : `${months} months ago`;
    } else if (weeks >= 1) {
        return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
    } else if (days >= 1) {
        return days === 1 ? '1 day ago' : `${days} days ago`;
    } else if (hours >= 1) {
        return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    } else if (minutes >= 1) {
        return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
    } else {
        return 'just now';
    }
}

export function calculateActualPostingDate(createdAt: string | Date, originalDatePosted: string): Date {
    const scrapeDate = new Date(createdAt);
    const originalAgeMs = parseRelativeTimeToMs(originalDatePosted);
    return new Date(scrapeDate.getTime() - originalAgeMs);
}