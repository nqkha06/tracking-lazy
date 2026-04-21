import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toMysqlDateTime } from '../../utils/detection.util';
import { StatsQueryDto } from './dto/stats-query.dto';
import { TrackingRepository } from './tracking.repository';
import {
  StatsGroupedRow,
  StatsQueryFilterInput,
  StatsSummary,
} from './tracking.types';

interface StatsQueryMeta {
  timezone: 'UTC';
  dateFrom: string;
  dateTo: string;
  groupBy: string;
  limit: number;
  filters: {
    userId?: number;
    linkId?: number;
    country?: string;
    device?: number;
    isEarn?: 0 | 1;
  };
  generatedAt: string;
}

export interface StatsQueryResponse {
  meta: StatsQueryMeta;
  summary: StatsSummary;
  rows: StatsGroupedRow[];
}

@Injectable()
export class TrackingStatsService {
  private readonly maxQueryDays: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly trackingRepository: TrackingRepository,
  ) {
    this.maxQueryDays = this.configService.get<number>(
      'STATS_QUERY_MAX_DAYS',
      93,
    );
  }

  async queryStats(query: StatsQueryDto): Promise<StatsQueryResponse> {
    const fromDate = this.parseDateOnlyUtc(query.dateFrom, 'dateFrom');
    const toDate = this.parseDateOnlyUtc(query.dateTo, 'dateTo');

    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('dateFrom must be <= dateTo');
    }

    const days =
      Math.floor((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
    if (days > this.maxQueryDays) {
      throw new BadRequestException(
        `Date range too large. Max ${this.maxQueryDays} days`,
      );
    }

    const endExclusive = new Date(toDate.getTime() + 86400000);
    const normalizedCountry = query.country
      ? query.country.trim().toUpperCase()
      : undefined;
    const groupBy = query.groupBy || 'day';
    const limit = query.limit || 500;

    const filters: StatsQueryFilterInput = {
      startAt: toMysqlDateTime(fromDate),
      endExclusive: toMysqlDateTime(endExclusive),
      userId: query.userId,
      linkId: query.linkId,
      country: normalizedCountry,
      device: query.device,
      isEarn: query.isEarn,
      groupBy,
      limit,
    };

    const [summary, rows] = await Promise.all([
      this.trackingRepository.queryStatsSummary(filters),
      this.trackingRepository.queryStatsGrouped(filters),
    ]);

    return {
      meta: {
        timezone: 'UTC',
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        groupBy,
        limit,
        filters: {
          userId: query.userId,
          linkId: query.linkId,
          country: normalizedCountry,
          device: query.device,
          isEarn: query.isEarn,
        },
        generatedAt: new Date().toISOString(),
      },
      summary,
      rows,
    };
  }

  private parseDateOnlyUtc(value: string, fieldName: string): Date {
    const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!matched) {
      throw new BadRequestException(`${fieldName} must be YYYY-MM-DD`);
    }

    const year = Number(matched[1]);
    const month = Number(matched[2]);
    const day = Number(matched[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));

    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new BadRequestException(
        `${fieldName} is not a valid calendar date`,
      );
    }

    return parsed;
  }
}
