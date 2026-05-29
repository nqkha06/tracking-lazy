import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../../redis/redis.service';
import { NoteAccessLogEntity } from '../../entities/note-access-log.entity';

@Injectable()
export class NoteAccessLogWorker {
  constructor(
    private readonly redisService: RedisService,
    @InjectRepository(NoteAccessLogEntity)
    private readonly noteAcc: Repository<NoteAccessLogEntity>,
  ) {}

  @Cron('*/5 * * * * *')
  async flushLogs(): Promise<void> {
    const pipeline = this.redisService.createPipeline();
    const batchSize = 1000;

    for (let i = 0; i < batchSize; i++) {
      pipeline.rpop('note_access_logs');
    }

    const results = await pipeline.exec();
    const logs = (results || [])
      .map(([, value]) => value)
      .filter(Boolean)
      .map((item) => JSON.parse(item as string));

    if (!logs.length) {
      return;
    }

    await this.noteAcc.insert(logs);
  }
}