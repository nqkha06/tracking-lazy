import { Controller, Get, HttpStatus, Param, Req, Res } from '@nestjs/common';
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
      response.redirect('https://link4sub.com/404?alias=' + encodeURIComponent(alias));
      return;
    }

    if (!data.redirectUrl) {
      response.redirect(HttpStatus.FOUND, '/');
      return;
    }

    response.redirect(HttpStatus.FOUND, data.redirectUrl);
  }

  @Get('/d/:alias')
  async detail(
    @Param('alias') alias: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const data = await this.stuService.getShowData(alias, request);

    if (!data) {
      response.redirect('https://link4sub.com/404?alias=' + encodeURIComponent(alias));
      return;
    }

    if (!data.redirectUrl) {
      response.redirect(HttpStatus.FOUND, '/');
      return;
    }

    return response.json(data);
  }
}
