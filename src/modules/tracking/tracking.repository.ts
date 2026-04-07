import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessLogEntity } from '../../entities/access-log.entity';
import { UserAgentEntity } from '../../entities/user-agent.entity';
import { detectBrowser, detectOs } from '../../utils/device.util';
import { AccessLogQueuePayload } from './tracking.types';

@Injectable()
export class TrackingRepository {
  constructor(
    @InjectRepository(AccessLogEntity)
    private readonly accessLogRepository: Repository<AccessLogEntity>,
    @InjectRepository(UserAgentEntity)
    private readonly userAgentRepository: Repository<UserAgentEntity>,
  ) {}

  async bulkInsertAccessLogs(payloads: AccessLogQueuePayload[]): Promise<void> {
    if (!payloads.length) {
      return;
    }

    const batchSize = 1000;
    for (let i = 0; i < payloads.length; i += batchSize) {
      const chunk = payloads.slice(i, i + batchSize);
      const values = chunk.map((payload) => ({
        linkId: payload.link_id,
        userId: payload.user_id,
        ipAddress: payload.ip,
        agentHash: payload.agent_hash,
        country: payload.country,
        device: payload.device,
        revenue: payload.revenue.toFixed(6),
        isEarn: payload.is_earn,
        detectionMask: payload.detection_mask,
        rejectReasonMask: payload.reject_reason_mask,
        createdAt: new Date(payload.created_at),
      }));

      await this.accessLogRepository
        .createQueryBuilder()
        .insert()
        .into(AccessLogEntity)
        .values(values)
        .execute();
    }
  }

  async ensureUserAgent(
    hash: string,
    raw: string,
    deviceType: number,
  ): Promise<void> {
    await this.userAgentRepository
      .createQueryBuilder()
      .insert()
      .into(UserAgentEntity)
      .values({
        hash,
        raw,
        browser: detectBrowser(raw),
        os: detectOs(raw),
        deviceType,
      })
      .orIgnore()
      .execute();
  }
}
