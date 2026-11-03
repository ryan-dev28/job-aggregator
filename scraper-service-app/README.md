# Job Aggregator Services

A TypeScript/NestJS backend for collecting, storing, searching, and managing job listings. The application is organized as a NestJS monorepo with four services:

- **Scraper service** collects recent job listings from Indeed and LinkedIn via Apify, and from SimplyHired and ZipRecruiter using a browser.
- **Storage service** persists jobs, users, and saved searches in PostgreSQL.
- **Search service** provides job search and saved-search endpoints, and supports processing job-alert emails.
- **User service** provides registration, OTP verification, sign-in, password reset, and contact-form endpoints.

The scraper currently targets finance leadership roles in the United States. It filters for recent listings and can enrich saved jobs with company revenue and industry information.

## Tech stack

- Node.js 20
- TypeScript 5
- NestJS 11
- PostgreSQL with TypeORM
- Puppeteer and Chromium
- Apify actors for Indeed and LinkedIn scraping
- Docker and Docker Compose

## Repository structure

```text
scraper-service-app/
├── apps/
│   ├── scraper-service/
│   ├── search-service/
│   ├── storage-service/
│   └── user-service/
├── libs/
│   └── common/
├── package.json
└── nest-cli.json
```

## Prerequisites

- Node.js 20
- Yarn
- PostgreSQL
- Chromium and Xvfb for running the scraper outside its Docker image
- Credentials for the external integrations you plan to use

## Setup

From this directory:

```bash
yarn install --frozen-lockfile
```

Configure the environment variables for the services you intend to run. Do not commit credentials or production secrets.

### Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DB_HOST` | Storage | PostgreSQL host or Cloud SQL socket path |
| `DB_PORT` | Storage | PostgreSQL port; defaults to `5432` |
| `DB_USER` | Storage | PostgreSQL username |
| `DB_PASS` | Storage | PostgreSQL password |
| `DB_NAME` | Storage | PostgreSQL database name |
| `STORAGE_SERVICE_HOST` | Scraper, search | Base URL of the storage service |
| `SEARCH_SERVICE_HOST` | Scraper | Base URL of the search service |
| `DATAIMPULSE_USERNAME` | Scraper | Proxy username |
| `DATAIMPULSE_PASSWORD` | Scraper | Proxy password |
| `DATAIMPULSE_PROXY_HOST` | Scraper | Proxy host |
| `DATAIMPULSE_PROXY_PORT` | Scraper | Proxy port |
| `INDEED_APIFY_API_TOKEN` | Scraper | Apify token for the Indeed actor |
| `INDEED_ACTOR_ID` | Scraper | Apify Indeed actor ID |
| `LINKEDIN_APIFY_API_TOKEN` | Scraper | Apify token for the LinkedIn actor |
| `LINKEDIN_ACTOR_ID` | Scraper | Apify LinkedIn actor ID |
| `SERPER_API_KEY` | Scraper | Serper API key for company revenue lookup |
| `SMTP_HOST` | Search, user | SMTP server hostname |
| `SMTP_PORT` | Search, user | SMTP server port |
| `SMTP_USER` | Search, user | SMTP username |
| `SMTP_PASSWORD` | Search, user | SMTP password |
| `SMTP_FROM_NAME` | Search, user | Sender display name; defaults to `No Reply` |
| `SMTP_FROM_EMAIL` | Search, user | Sender email address |
| `JWT_SECRET` | User | Secret used to sign JWTs |
| `JWT_ACCESS_EXPIRES_IN` | User | Access-token lifetime; defaults to `15m` |
| `CACHE_TTL` | User | Cache lifetime |
| `CACHE_MAX_ITEMS` | User | Maximum cache items |
| `JOB_RETENTION_DAYS` | Scraper | Job retention period; defaults to `60` |
| `NODE_ENV` | Storage, scraper, user | Runtime environment |
| `PORT` | Storage | Listening port; defaults to `3003` |

The scraper also uses Chromium environment settings in Docker: `PUPPETEER_EXECUTABLE_PATH`, `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD`, `CHROME_PATH`, `DISPLAY`, and `XVFB_WHD`.

Apify credentials and proxy settings are needed for their corresponding scraping integrations. If an Apify token is not configured, that source is skipped. Company revenue lookup is skipped when `SERPER_API_KEY` is not configured.

## Run locally

The package scripts are defined in `package.json`:

```bash
# Start the configured Nest application
yarn start

# Start in watch mode
yarn start:dev

# Start in debug/watch mode
yarn start:debug

# Build
yarn build

# Run in production mode
yarn start:prod
```

This is a monorepo with separate Nest applications. To start a particular application, pass its project name to the relevant Nest command, for example:

```bash
yarn start:dev scraper-service
yarn start:dev search-service
yarn start:dev storage-service
yarn start:dev user-service
```

The services use these default ports in the provided Compose configuration:

| Service | Port |
| --- | ---: |
| Scraper | `3001` |
| Search | `3002` |
| Storage | `3003` |
| User | `3004` |

The storage service also honors the `PORT` environment variable.

## Run with Docker Compose

The repository-root Compose file builds all four services. From the repository root:

```bash
docker compose -f docker-compose.app.yml up --build
```

Configure database, SMTP, authentication, and scraping credentials before using the services. Review the Compose file’s service URLs and environment settings to ensure they point to the intended dependencies.

The scraper container includes Chromium and Xvfb. It may need more shared memory and memory than the API services.

## HTTP endpoints

These are the main routes implemented by the controllers. The service base URL and port depend on your runtime configuration.

### Scraper service

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/scrape-manual` | Manually start a scrape |
| `POST` | `/scrape` | Start a scrape; requires the `X-CloudScheduler` header |
| `POST` | `/get-company-revenue` | Look up revenue for the `companyName` in the request body |
| `POST` | `/get-company-industry-info` | Look up industry information for the `companyName` in the request body |

Example request:

```bash
curl -X POST http://localhost:3001/get-company-revenue \
  -H "Content-Type: application/json" \
  -d '{"companyName":"Example Company"}'
```

### Search service

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/jobs` | Search jobs. Supports filters such as `search`, `company`, `title`, `keyword`, `location`, `datePosted`, `sort`, `revenue`, and `industry`, plus pagination. |
| `POST` | `/jobs/save-searches` | Save a search |
| `GET` | `/jobs/fetch-user-searches/:userId` | Fetch a user's saved searches |
| `PUT` | `/jobs/update-search-alert` | Enable or disable a saved-search alert |
| `POST` | `/jobs/process-new-jobs-alert` | Process new jobs for alerts |

### Storage service

The storage service exposes job search and persistence routes under `/jobs`, including:

- `GET /jobs` — search stored jobs
- `POST /jobs/save` — save or update a job
- `GET /jobs/new` — fetch new jobs
- `POST /jobs/cleanup?days=<number>` — remove older jobs; defaults to 60 days
- `POST /jobs/searches` and `GET /jobs/searches?userId=<id>` — manage saved searches

It also provides user and OTP routes used by the user service.

### User service

Authentication and account routes are under `/auth`, including registration, OTP verification, sign-in, fetching the authenticated user, and password reset. The user service serves Swagger documentation at:

```text
http://localhost:3004/api
```

## Tests and code quality

```bash
# Unit tests
yarn test

# Watch tests
yarn test:watch

# Coverage
yarn test:cov

# End-to-end tests
yarn test:e2e

# Lint TypeScript files
yarn lint

# Format application and library TypeScript files
yarn format
```

## Notes

- PostgreSQL schema synchronization is enabled outside production by the current storage configuration. Use a deliberate migration strategy for production deployments.
- Scraping behavior and available data depend on the source sites and configured third-party integrations. Follow the relevant sites’ terms and applicable laws.
- Never commit API tokens, passwords, database credentials, or JWT secrets.
