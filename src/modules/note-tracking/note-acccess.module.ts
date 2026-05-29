import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserAgentEntity } from '../../entities/user-agent.entity';
import { NoteAccessLogDailyEntity } from '../../entities/note-access-log-daily.entity';
import { NoteAccessLogEntity } from '../../entities/note-access-log.entity';
import { NoteAccessController } from './note-access.controller';
import { TrackingRepository } from './tracking.repository';
import { NoteQueryController } from './note-query.controller';
import { TrackingStatsService } from './tracking-stats.service';
import { NoteAccessService } from './note-access.service';
import { TrackingWorker } from './tracking.worker';
import { NoteAccessLogWorker } from './note-access-log.worker';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserAgentEntity, NoteAccessLogEntity, NoteAccessLogDailyEntity]),
  ],
  controllers: [NoteAccessController, NoteQueryController],
  providers: [NoteAccessService, TrackingStatsService, TrackingRepository, NoteAccessLogWorker],
})
export class NoteAccessModule {}
