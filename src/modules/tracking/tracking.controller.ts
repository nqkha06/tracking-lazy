import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { TrackRequestDto } from './dto/track-request.dto';
import { TrackingService } from './tracking.service';
import { TrackResult } from './tracking.types';

@Controller('cnt')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post(':alias')
  @HttpCode(HttpStatus.OK)
  async track(
    @Param('alias') alias: string,
    @Body() body: TrackRequestDto,
    @Req() request: Request,
  ): Promise<TrackResult> {
    const ipAddress = this.extractClientIp(request);
    const userAgent = request.header('user-agent') || '';

    return this.trackingService.trackVisit(alias, body, ipAddress, userAgent);
  }

  private extractClientIp(request: Request): string {
    const forwardedFor = request.header('x-forwarded-for');
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
      const firstIp = forwardedFor.split(',')[0];
      return (firstIp || '').trim();
    }

    return request.ip || request.socket.remoteAddress || '0.0.0.0';
  }
}
