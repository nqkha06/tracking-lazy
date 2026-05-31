import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RedisService } from '../../redis/redis.service';
import { AccessLogEntity } from '../../entities/access-log.entity';

@Injectable()
export class NoteAccessLogWorker {
  constructor(
    private readonly redisService: RedisService,
    @InjectRepository(AccessLogEntity)
    private readonly accessLogRepository: Repository<AccessLogEntity>,
    @InjectDataSource('application')
    private readonly appDataSource: DataSource,
  ) {}

  @Cron('*/30 * * * * *')
  async flushLogs(): Promise<void> {
    const pipeline = this.redisService.createPipeline();
    const batchSize = 1000;

    for (let i = 0; i < batchSize; i++) {
      pipeline.rpop('logs_queue');
    }

    const results = await pipeline.exec();
    const logs = (results || [])
      .map(([, value]) => value)
      .filter(Boolean)
      .map((item) => JSON.parse(item as string));

    if (!logs.length) {
      return;
    }

    await this.accessLogRepository.insert(logs);
    await this.incrementUserBalances(logs);
    await this.incrementLinkStats(logs);
  }

  private async incrementUserBalances(logs: Array<Record<string, unknown>>): Promise<void> {
    const revenueByUser = new Map<number, bigint>();

    for (const log of logs) {
      const userId = Number(log.userId);
      if (!Number.isFinite(userId) || userId <= 0) {
        continue;
      }

      const isEarn = Number(log.isEarn);
      if (isEarn !== 1) {
        continue;
      }

      const revenue = this.toScaledInt(String(log.revenue ?? '0'), 6);
      if (revenue === 0n) {
        continue;
      }

      revenueByUser.set(userId, (revenueByUser.get(userId) || 0n) + revenue);
    }

    if (revenueByUser.size === 0) {
      return;
    }

    const ids = Array.from(revenueByUser.keys());
    const caseFragments = ids.map(() => 'WHEN ? THEN ?').join(' ');
    const idPlaceholders = ids.map(() => '?').join(', ');
    const params: Array<number | string> = [];

    for (const id of ids) {
      params.push(id, this.fromScaledInt(revenueByUser.get(id) || 0n, 6));
    }

    params.push(...ids);

    await this.appDataSource.query(
      `UPDATE users
       SET balance = balance + CASE id ${caseFragments} ELSE 0 END
       WHERE id IN (${idPlaceholders})`,
      params,
    );
  }

  private async incrementLinkStats(logs: Array<Record<string, unknown>>): Promise<void> {
    const revenueByLink = new Map<number, bigint>();
    const viewsByLink = new Map<number, number>();

    for (const log of logs) {
      const linkId = Number(log.linkId);
      if (!Number.isFinite(linkId) || linkId <= 0) {
        continue;
      }

      viewsByLink.set(linkId, (viewsByLink.get(linkId) || 0) + 1);

      const revenue = this.toScaledInt(String(log.revenue ?? '0'), 6);
      if (revenue === 0n) {
        continue;
      }

      revenueByLink.set(linkId, (revenueByLink.get(linkId) || 0n) + revenue);
    }

    if (viewsByLink.size === 0 && revenueByLink.size === 0) {
      return;
    }

    const linkIds = Array.from(new Set([...viewsByLink.keys(), ...revenueByLink.keys()]));
    const revenueCases = linkIds.map(() => 'WHEN ? THEN ?').join(' ');
    const viewsCases = linkIds.map(() => 'WHEN ? THEN ?').join(' ');
    const idPlaceholders = linkIds.map(() => '?').join(', ');
    const params: Array<number | string> = [];

    for (const id of linkIds) {
      params.push(id, this.fromScaledInt(revenueByLink.get(id) || 0n, 6));
    }

    for (const id of linkIds) {
      params.push(id, String(viewsByLink.get(id) || 0));
    }

    params.push(...linkIds);

    await this.appDataSource.query(
      `UPDATE note_links
       SET revenue = revenue + CASE id ${revenueCases} ELSE 0 END,
           views = views + CASE id ${viewsCases} ELSE 0 END
       WHERE id IN (${idPlaceholders})`,
      params,
    );
  }

  private toScaledInt(value: string, scale: number): bigint {
    const normalized = value.trim();

    if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
      return 0n;
    }

    const negative = normalized.startsWith('-');
    const [intPart, fracPart = ''] = normalized.replace('-', '').split('.');
    const paddedFraction = (fracPart + '0'.repeat(scale)).slice(0, scale);
    const combined = BigInt(`${intPart}${paddedFraction}` || '0');

    return negative ? -combined : combined;
  }

  private fromScaledInt(value: bigint, scale: number): string {
    const negative = value < 0n;
    const absValue = negative ? -value : value;
    const raw = absValue.toString().padStart(scale + 1, '0');
    const intPart = raw.slice(0, -scale);
    const fracPart = raw.slice(-scale);
    const formatted = `${intPart}.${fracPart}`;

    return negative ? `-${formatted}` : formatted;
  }
}