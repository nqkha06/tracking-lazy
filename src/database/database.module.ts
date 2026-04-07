import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessLogEntity } from '../entities/access-log.entity';
import { UserAgentEntity } from '../entities/user-agent.entity';

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return value === 'true' || value === '1';
}

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql' as const,
        host: configService.get<string>('DB_HOST', '127.0.0.1'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USER', 'root'),
        password: configService.get<string>('DB_PASSWORD', ''),
        database: configService.get<string>('DB_NAME', 'tracking'),
        charset: 'utf8mb4_unicode_ci',
        timezone: 'Z',
        entities: [AccessLogEntity, UserAgentEntity],
        synchronize: parseBoolean(configService.get<string>('DB_SYNC'), false),
        logging: parseBoolean(configService.get<string>('DB_LOGGING'), false),
        extra: {
          connectionLimit: configService.get<number>('DB_POOL_SIZE', 50),
        },
      }),
    }),
  ],
})
export class DatabaseModule {}
