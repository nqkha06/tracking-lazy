import { Injectable } from '@nestjs/common';
import UAParser from 'ua-parser-js';

@Injectable()
export class UaParserService {
  private readonly uaParser: UAParser.UAParser;

  constructor() {
    this.uaParser = new UAParser.UAParser();
  }

  public parse(userAgent: string): UAParser.IResult {
    return this.uaParser.setUA(userAgent).getResult();
  }
}
