import { Injectable } from '@nestjs/common';
const UAParser = require('ua-parser-js');

@Injectable()
export class UaParserService {
    private readonly uaParser: any;

    constructor() {
        this.uaParser = new UAParser();
    }

    public parse(userAgent: string) {
        return this.uaParser.setUA(userAgent).getResult();
    }
}