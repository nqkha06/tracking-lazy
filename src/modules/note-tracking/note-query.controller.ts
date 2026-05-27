import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { NoteAccessService } from './note-access.service';
import { NoteAccessFiltersDto, NoteAccessQueryDto } from './dto/get-note-access-filter.dto';

@Controller('internal/n/stats')
export class NoteQueryController {
  constructor(private readonly NoteAccessService: NoteAccessService) {}

  @Get('query')
  @HttpCode(HttpStatus.OK)
  async queryByParams(@Query() query: NoteAccessQueryDto) {
    // this.assertAuthorized(request);
    return { success: true, ...await this.NoteAccessService.findAll(query) };
  }

  private assertAuthorized(request: Request): void {
    const expectedToken = process.env.LINK4SUB_INTERNAL_SECRET_KEY?.trim();
    const inputToken = this.extractToken(request);

    if (!expectedToken || !inputToken || !this.isTokenMatched(inputToken, expectedToken)) {
      throw new UnauthorizedException('Invalid internal token');
    }
  }

  private extractToken(request: Request): string {
    const headerToken = request.header('x-internal-token') || '';

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
