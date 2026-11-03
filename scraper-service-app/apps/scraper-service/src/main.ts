import { NestFactory } from '@nestjs/core';
import { ScraperServiceModule } from './scraper-service.module';

async function bootstrap() {
  const app = await NestFactory.create(ScraperServiceModule);
  await app.listen(3001);
}
bootstrap();
