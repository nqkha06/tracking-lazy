import { Body, Controller, HttpCode, HttpStatus, Param, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TrackRequestDto } from './dto/track-request.dto';
import { NoteAccessService } from './note-access.service';
import { TrackResult } from './tracking.types';

@Controller('n/a')
export class NoteAccessController {
  constructor(private readonly trackingService: NoteAccessService) {}

  @Post(':alias')
  @HttpCode(HttpStatus.OK)
  async track(
    @Param('alias') alias: string,
    @Body() body: TrackRequestDto,
    @Req() request: Request,
  ) {
    return 123;
    const xxIpAddress = this.extractClientIp(request);
    const xxUa = request.header('xx-ua') || '';

  }

  @Get(':alias')
  @HttpCode(HttpStatus.OK)
  async trackGet(@Param('alias') alias: string, @Req() request: Request){
    const xxIpAddress = this.extractClientIp(request);
    const xxUa = request.header('xx-ua') || '';

    const payload = {
      linkId: 1,
      userId: 1,
      levelId: 1,
      ipAddress: xxIpAddress,
      agentHash: xxUa,
      country: this.getCountryFromHeader(request),
      device: 1,
      revenue: '0.00',
      isEarn: 0,
      detectionMask: 0,
      rejectReasonMask: 0,
    };
    
    return this.trackingService.createAsync(payload);
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
