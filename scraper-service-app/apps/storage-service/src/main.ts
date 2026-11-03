import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(require('express').json({
    limit: '50mb'
  }));

  app.use(require('express').urlencoded({
    extended: true,
    limit: '50mb'
  }));

  app.useGlobalPipes(new ValidationPipe({
    whitelist: false,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
    forbidNonWhitelisted: false,
  }));

  const port = process.env.PORT || 3003;

  await app.listen(port, '0.0.0.0');

  console.log(`Storage service is running on port ${port}`);
}
bootstrap();