import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { STATS_GROUP_BY_VALUES, type StatsGroupBy } from '../tracking.types';

function toOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    if (/^-?\d+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }
  }

  return Number.NaN;
}

function toOptionalBinaryFlag(value: unknown): 0 | 1 | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value as 0 | 1;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return 1;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return 0;
    }
  }

  return Number.NaN as 0 | 1;
}

export class StatsQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toOptionalInt(value))
  @IsInt()
  @Min(1)
  userId?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toOptionalInt(value))
  @IsInt()
  @Min(1)
  linkId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^[a-zA-Z]{2,10}$/)
  country?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toOptionalInt(value))
  @IsInt()
  @IsIn([1, 2, 3])
  device?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toOptionalBinaryFlag(value))
  @IsInt()
  @IsIn([0, 1])
  isEarn?: 0 | 1;

  @IsOptional()
  @IsString()
  @IsIn(STATS_GROUP_BY_VALUES)
  groupBy?: StatsGroupBy;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toOptionalInt(value))
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}
