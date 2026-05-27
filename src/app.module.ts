import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { HttpModule } from './http/http.module';
import { StuModule } from './modules/stu/stu.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { RedisModule } from './redis/redis.module';
import { UaParserService } from './ua-parser/ua-parser.service';
import { NoteAccessModule } from './modules/note-tracking/note-acccess.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 600,
      },
    ]),
    DatabaseModule,
    RedisModule,
    HttpModule,
    StuModule,
    NoteAccessModule,
    TrackingModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    UaParserService,
  ],
})
export class AppModule {}
