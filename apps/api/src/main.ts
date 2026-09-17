import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { assertProductionConfig } from './common/production-config';

async function bootstrap() {
  assertProductionConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Requests arrive through Render's proxy and the web app's /api proxy. Trust
  // them for the client address, which reveal logs and login limits use.
  app.set('trust proxy', true);
  app.use(cookieParser());
  app.enableCors({
    origin: (process.env.WEB_ORIGIN || 'http://localhost:3000').split(','),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableShutdownHooks();

  // BigInt (telegramUserId) and Decimal (hoursReported) are not JSON-serializable
  // by default. Patch once here rather than mapping every response by hand.
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };

  const port = Number(process.env.PORT || 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`orchestrator listening on port ${port}`);
}
bootstrap().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
