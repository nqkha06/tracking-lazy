import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessLogEntity } from '../../entities/access-log.entity';
import { UserAgentEntity } from '../../entities/user-agent.entity';
import { TrackingController } from './tracking.controller';
import { TrackingRepository } from './tracking.repository';
import { TrackingService } from './tracking.service';
import { TrackingWorker } from './tracking.worker';

@Module({
  imports: [TypeOrmModule.forFeature([AccessLogEntity, UserAgentEntity])],
  controllers: [TrackingController],
  providers: [TrackingService, TrackingRepository, TrackingWorker],
})
export class TrackingModule {}
