import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StuLevelRow, StuLinkRow } from './stu.types';

@Injectable()
export class StuRepository {
  private readonly stuTable: string;
  private readonly levelsTable: string;
  private readonly settingsTable: string;

  constructor(
    @InjectDataSource('application')
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.stuTable = this.quoteIdentifier(
      this.configService.get<string>('A_DB_STU_TABLE', 'stu_links'),
    );
    this.levelsTable = this.quoteIdentifier(
      this.configService.get<string>('A_DB_LEVELS_TABLE', 'levels'),
    );
    this.settingsTable = this.quoteIdentifier(
      this.configService.get<string>('A_DB_SETTINGS_TABLE', 'user_settings'),
    );
  }

  async findLinkByAlias(alias: string): Promise<StuLinkRow | null> {
    const result = (await this.dataSource.query(
      `SELECT
          stu.id,
          stu.alias,
          stu.user_id,
          stu.level_id,
          stu.status,
          stu.deleted_at,
          level.redirect_settings AS level_redirect_settings,
          auto_level.value AS auto_level_id
        FROM stu_links AS stu
        LEFT JOIN levels AS level ON level.id = stu.level_id
        LEFT JOIN user_settings AS auto_level
          ON auto_level.user_id = stu.user_id
          AND auto_level.\`key\` = ?
        WHERE stu.alias = ?
        LIMIT 1`,
      ['auto_level', alias],
    )) as unknown;

    if (!Array.isArray(result)) {
      return null;
    }

    return (result[0] as StuLinkRow | undefined) || null;
  }

  async findLevelById(levelId: number): Promise<StuLevelRow | null> {
    const result = (await this.dataSource.query(
      `SELECT id, pageload_config AS redirect_settings
      FROM ${this.levelsTable}
      WHERE id = ?
      LIMIT 1`,
      [levelId],
    )) as unknown;

    if (!Array.isArray(result)) {
      return null;
    }

    return (result[0] as StuLevelRow | undefined) || null;
  }

  private quoteIdentifier(identifier: string): string {
    if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
      throw new Error(`Invalid database identifier: ${identifier}`);
    }

    return `\`${identifier}\``;
  }
}
