import { Body, Controller, HttpCode, HttpStatus, Param, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TrackRequestDto } from './dto/track-request.dto';
import { TrackingService } from './tracking.service';
import { TrackResult } from './tracking.types';

@Controller('note-cnt')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post(':alias')
  @HttpCode(HttpStatus.OK)
  async track(
    @Param('alias') alias: string,
    @Body() body: TrackRequestDto,
    @Req() request: Request,
  ): Promise<TrackResult> {
    const xxIpAddress = this.extractClientIp(request);
    const xxUa = request.header('xx-ua') || '';
    const xxReferer = request.header('xx-referer') || '';

    return this.trackingService.trackVisit(alias, body, xxIpAddress, xxUa);
  }

  @Get(':alias')
  @HttpCode(HttpStatus.OK)
  async trackGet(@Param('alias') alias: string, @Req() request: Request): Promise<TrackResult> {
    const xxIpAddress = this.extractClientIp(request);
    const xxUa = request.header('xx-ua') || '';
    const xxReferer = request.header('xx-referer') || '';
    const body: TrackRequestDto = {
      country: this.getCountryFromHeader(request),
      adBlock: false,
      proxyVpn: false,
      ipChange: false,
    };
    return this.trackingService.trackVisit(alias, body, xxIpAddress, xxUa);
  }

  private extractClientIp(request: Request): string {
    const forwardedFor = request.header('xx-ip-address') || request.header('x-forwarded-for');
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
      const firstIp = forwardedFor.split(',')[0];
      return (firstIp || '').trim();
    }

    return request.ip || request.socket.remoteAddress || '0.0.0.0';
  }

  private getCountryFromHeader(request: Request): string {
    const country = request.header('CF-IPCountry') || 'XX';
    return country;
  }
}
