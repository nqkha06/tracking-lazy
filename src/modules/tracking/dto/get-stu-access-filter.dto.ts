import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const toNumberArray = ({ value }: { value: unknown }): number[] | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const rawValue = Array.isArray(value) ? value.join(',') : String(value);

  return rawValue
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item));
};

const toStringArray = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const rawValue = Array.isArray(value) ? value.join(',') : String(value);

  return rawValue
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
};

const toFieldArray = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const rawValue = Array.isArray(value) ? value.join(',') : String(value);

  return rawValue
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

export class StuAccessFiltersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  link_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  user_id?: number;

  @IsOptional()
  @Transform(toStringArray)
  country?: string[];

  @IsOptional()
  @Transform(toNumberArray)
  device?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  is_earn?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  reject_reason_mask?: number;

  @IsOptional()
  @IsString()
  ip_address?: string;
}

export class StuAccessDateDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class StuAccessSortDto {
  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  created_at?: 'ASC' | 'DESC' | 'asc' | 'desc';

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  date?: 'ASC' | 'DESC' | 'asc' | 'desc';

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  revenue?: 'ASC' | 'DESC' | 'asc' | 'desc';

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  views?: 'ASC' | 'DESC' | 'asc' | 'desc';

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  link_id?: 'ASC' | 'DESC' | 'asc' | 'desc';

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  user_id?: 'ASC' | 'DESC' | 'asc' | 'desc';

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  level_id?: 'ASC' | 'DESC' | 'asc' | 'desc';

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  id?: 'ASC' | 'DESC' | 'asc' | 'desc';
}

export class StuAccessQueryDto {
  @IsOptional()
  @Transform(toFieldArray)
  @IsArray()
  @IsString({ each: true })
  @IsIn(
    [
      'id',
      'link_id',
      'user_id',
      'level_id',
      'ip_address',
      'agent_hash',
      'country',
      'device',
      'revenue',
      'is_earn',
      'detection_mask',
      'reject_reason_mask',
      'created_at',
      'user_agents.hash',
      'user_agents.raw',
      'user_agents.browser',
      'user_agents.os',
      'user_agents.device_type',
    ],
    { each: true },
  )
  selects?: string[];

  @IsOptional()
  @Transform(toFieldArray)
  @IsArray()
  @IsString({ each: true })
  @IsIn(['date', 'level_id', 'link_id', 'user_id', 'country'], { each: true })
  groups?: string[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => StuAccessFiltersDto)
  filters?: StuAccessFiltersDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => StuAccessDateDto)
  date?: StuAccessDateDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => StuAccessSortDto)
  sort?: StuAccessSortDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}