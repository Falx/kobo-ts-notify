import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceThresholdEur?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minDiscountPercent?: number;

  @IsOptional()
  @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/, {
    message: 'checkTime must be 24h HH:MM',
  })
  checkTime?: string;

  @IsOptional()
  @IsString()
  tz?: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsString()
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @IsOptional()
  @IsString()
  smtpUser?: string;

  @IsOptional()
  @IsString()
  smtpPassword?: string;

  @IsOptional()
  @IsBoolean()
  smtpTls?: boolean;

  @IsOptional()
  @IsString()
  emailFrom?: string;

  @IsOptional()
  @IsString()
  emailTo?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  maxCovers?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(60)
  coverTimeoutSec?: number;
}

export class DealsQueryDto {
  @IsOptional()
  @IsIn(['wishlist', 'bestdeals'])
  source?: string;

  @IsOptional()
  @IsIn(['true', 'false', '1', '0'])
  isNew?: string;

  @IsOptional()
  @IsIn(['true', 'false', '1', '0'])
  isDrop?: string;

  @IsOptional()
  @IsIn(['true', 'false', '1', '0'])
  isOwned?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minDiscount?: number;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['latest', 'price-asc', 'price-desc', 'discount-desc'])
  sort?: string;
}

export class RunParamsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;
}

export class PairParamsDto {
  @IsString()
  pairingId!: string;
}
