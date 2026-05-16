import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessLogDailyEntity } from '../entities/access-log-daily.entity';
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
        timezone: configService.get<string>('DB_TIMEZONE', 'Z'),
        entities: [AccessLogEntity, AccessLogDailyEntity, UserAgentEntity],
        synchronize: parseBoolean(configService.get<string>('DB_SYNC'), false),
        logging: parseBoolean(configService.get<string>('DB_LOGGING'), false),
        extra: {
          connectionLimit: configService.get<number>('DB_POOL_SIZE', 50),
        },
      }),
    }),
    TypeOrmModule.forRootAsync({
      name: 'application',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql' as const,
        host: configService.get<string>('A_DB_HOST', '127.0.0.1'),
        port: configService.get<number>('A_DB_PORT', 3306),
        username: configService.get<string>('A_DB_USER', 'root'),
        password: configService.get<string>('A_DB_PASSWORD', ''),
        database: configService.get<string>('A_DB_NAME', 'tracking'),
        charset: 'utf8mb4_unicode_ci',
        timezone: configService.get<string>(
          'A_DB_TIMEZONE',
          configService.get<string>('DB_TIMEZONE', 'Z'),
        ),
        entities: [],
        synchronize: parseBoolean(
          configService.get<string>('A_DB_SYNC'),
          false,
        ),
        logging: parseBoolean(configService.get<string>('A_DB_LOGGING'), false),
        extra: {
          connectionLimit: configService.get<number>('A_DB_POOL_SIZE', 50),
        },
      }),
    }),
  ],
})
export class DatabaseModule {}
