import { Test, TestingModule } from '@nestjs/testing';
import { UaParserService } from './ua-parser.service';

describe('UaParserService', () => {
  let service: UaParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UaParserService],
    }).compile();

    service = module.get<UaParserService>(UaParserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
