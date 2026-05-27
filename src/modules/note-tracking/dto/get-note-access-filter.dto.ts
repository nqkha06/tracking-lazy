import { Transform, Type } from 'class-transformer';
import {
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

export class NoteAccessFiltersDto {
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

export class NoteAccessDateDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class NoteAccessSortDto {
  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  created_at?: 'ASC' | 'DESC' | 'asc' | 'desc';

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  revenue?: 'ASC' | 'DESC' | 'asc' | 'desc';

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  id?: 'ASC' | 'DESC' | 'asc' | 'desc';
}

export class NoteAccessQueryDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NoteAccessFiltersDto)
  filters?: NoteAccessFiltersDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NoteAccessDateDto)
  date?: NoteAccessDateDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NoteAccessSortDto)
  sort?: NoteAccessSortDto;

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