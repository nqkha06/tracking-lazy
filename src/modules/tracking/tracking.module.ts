import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessLogDailyEntity } from '../../entities/access-log-daily.entity';
import { AccessLogEntity } from '../../entities/access-log.entity';
import { UserAgentEntity } from '../../entities/user-agent.entity';
import { TrackingController } from './tracking.controller';
import { TrackingRepository } from './tracking.repository';
import { TrackingStatsController } from './tracking-stats.controller';
import { TrackingStatsService } from './tracking-stats.service';
import { TrackingService } from './tracking.service';
import { TrackingWorker } from './tracking.worker';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccessLogEntity,
      AccessLogDailyEntity,
      UserAgentEntity,
    ]),
  ],
  controllers: [TrackingController, TrackingStatsController],
  providers: [
    TrackingService,
    TrackingStatsService,
    TrackingRepository,
    TrackingWorker,
  ],
})
export class TrackingModule {}
