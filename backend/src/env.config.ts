import { plainToClass, Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export class EnvironmentVariables {
  @IsOptional()
  @IsString()
  NODE_ENV: string = 'development';

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @Max(65535)
  PORT: number = 3333;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  ORD_API_URL: string = 'https://ord.cat21.space';

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1000)
  SYNC_INTERVAL_MS: number = 60000;

  @IsOptional()
  @IsString()
  CORS_ORIGINS: string = 'http://localhost:4200';
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToClass(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    forbidUnknownValues: true,
  });

  if (errors.length > 0) {
    throw new Error(
      `Config validation failed:\n${errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }

  return validated;
}
