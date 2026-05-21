import { Controller, Get, HttpStatus, NotFoundException, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { StuService } from './stu.service';

@Controller('stu')
export class StuController {
  constructor(private readonly stuService: StuService) {}

  @Get(':alias')
  async show(
    @Param('alias') alias: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const data = await this.stuService.getShowData(alias, request);

    if (!data) {
      throw new NotFoundException('Link not found');
    }

    if (!data.redirectUrl) {
      response.redirect(HttpStatus.FOUND, '/');
      return;
    }

    response.redirect(HttpStatus.FOUND, data.redirectUrl);
  }
}
