import { Expose, Transform } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  STATS_GROUP_BY_VALUES,
  STATS_ORDER_DIRECTION_VALUES,
} from '../tracking.types';

const toInt = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  if (Number.isInteger(parsed)) {
    return parsed;
  }

  return Number.NaN;
};

const toBinary = (value: unknown): 0 | 1 | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return 1;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return 0;
  }

  return Number.NaN as 0 | 1;
};

const toArray = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const normalizeItems = (items: unknown[]): string[] => {
    return items
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  };

  if (Array.isArray(value)) {
    const normalized = normalizeItems(value);
    return normalized.length ? normalized : undefined;
  }

  const normalized = normalizeItems([value]);
  return normalized.length ? normalized : undefined;
};

export class StatsQueryDto {
  @Expose({ name: 'created_at_from' })
  @IsOptional()
  @IsString()
  createdAtFrom?: string;

  @Expose({ name: 'created_at_to' })
  @IsOptional()
  @IsString()
  createdAtTo?: string;

  @Expose({ name: 'user_id' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toInt(value))
  @IsInt()
  @Min(1)
  userId?: number;

  @Expose({ name: 'link_id' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toInt(value))
  @IsInt()
  @Min(1)
  linkId?: number;

  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^[a-zA-Z]{2,10}$/)
  country?: string;

  @Expose()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toInt(value))
  @IsInt()
  @IsIn([1, 2, 3])
  device?: number;

  @Expose({ name: 'is_earn' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toBinary(value))
  @IsInt()
  @IsIn([0, 1])
  isEarn?: 0 | 1;

  @Expose()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toArray(value))
  @IsArray()
  @IsString({ each: true })
  select?: string[];

  @Expose({ name: 'group_fields' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toArray(value))
  @IsArray()
  @IsString({ each: true })
  groupFields?: string[];

  // backward-compatible inputs
  @Expose()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toArray(value))
  @IsArray()
  @IsString({ each: true })
  groups?: string[];

  @Expose({ name: 'group_by' })
  @IsOptional()
  @IsString()
  @IsIn(STATS_GROUP_BY_VALUES)
  groupBy?: (typeof STATS_GROUP_BY_VALUES)[number];

  @Expose({ name: 'order_by' })
  @IsOptional()
  @IsString()
  orderBy?: string;

  @Expose({ name: 'order_direction' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    const normalized = String(value).trim().toLowerCase();
    return normalized ? normalized : undefined;
  })
  @IsString()
  @IsIn(STATS_ORDER_DIRECTION_VALUES)
  orderDirection?: (typeof STATS_ORDER_DIRECTION_VALUES)[number];

  @Expose()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toInt(value))
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;

  @Expose()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toInt(value))
  @IsInt()
  @Min(1)
  page?: number;

  // new-style dynamic filter JSON
  @Expose()
  @IsOptional()
  @IsString()
  where?: string;

  // backward-compatible dynamic filter JSON
  @Expose()
  @IsOptional()
  @IsString()
  filters?: string;
}
