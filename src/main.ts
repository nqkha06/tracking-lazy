import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        excludeExtraneousValues: true, // BẮT BUỘC
      },
    }),
  );

  app.set('trust proxy', true);
  // for dev
  app.enableCors({
    origin: true,
    credentials: true,
  });
  // app.enableCors({
  //   origin: ['http://localhost:8010'],
  //   credentials: true, // nếu dùng cookie/session
  // });

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);
}

void bootstrap();
