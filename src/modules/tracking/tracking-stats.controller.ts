import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { StatsQueryDto } from './dto/stats-query.dto';
import {
  StatsQueryResponse,
  TrackingStatsService,
} from './tracking-stats.service';

@Controller('internal/stats')
export class TrackingStatsController {
  constructor(
    private readonly configService: ConfigService,
    private readonly trackingStatsService: TrackingStatsService,
  ) {}

  @Get('query')
  @HttpCode(HttpStatus.OK)
  async queryByParams(
    @Query() query: StatsQueryDto,
    @Req() request: Request,
  ): Promise<StatsQueryResponse> {
    // this.assertAuthorized(request);
    return this.trackingStatsService.queryStats(query);
  }

  private assertAuthorized(request: Request): void {
    const expectedToken = (
      this.configService.get<string>('INTERNAL_STATS_API_TOKEN', '') || ''
    ).trim();
    const inputToken = this.extractToken(request);

    if (
      !expectedToken ||
      !inputToken ||
      !this.isTokenMatched(inputToken, expectedToken)
    ) {
      throw new UnauthorizedException('Invalid internal token');
    }
  }

  private extractToken(request: Request): string {
    const headerToken =
      request.header('x-internal-token') ||
      request.header('x-laravel-token') ||
      '';

    if (headerToken.trim()) {
      return headerToken.trim();
    }

    const authorization = request.header('authorization') || '';
    const matched = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    return matched?.[1]?.trim() || '';
  }

  private isTokenMatched(inputToken: string, expectedToken: string): boolean {
    const left = Buffer.from(inputToken);
    const right = Buffer.from(expectedToken);

    if (left.length !== right.length) {
      return false;
    }

    return timingSafeEqual(left, right);
  }
}
