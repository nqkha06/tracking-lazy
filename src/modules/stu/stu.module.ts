import { Module } from '@nestjs/common';
import { UaParserService } from '../../ua-parser/ua-parser.service';
import { StuController } from './stu.controller';
import { StuRepository } from './stu.repository';
import { StuService } from './stu.service';

@Module({
  controllers: [StuController],
  providers: [StuService, StuRepository, UaParserService],
})
export class StuModule {}
