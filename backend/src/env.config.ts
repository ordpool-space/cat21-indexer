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

  @IsOptional()
  @IsString()
  HOST: string = '0.0.0.0';

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  ORD_API_URL: string = 'https://ord.cat21.space';

  /**
   * Esplora-style electrs base URL — used by the bids pruner to check
   * buyer funding UTXOs for liveness (`/tx/<txid>/outspend/<vout>`).
   * Prod uses `https://api.ordpool.space/api` (ordpool-backend's
   * transparent electrs proxy on happysrv). Dev + regtest override.
   */
  @IsString()
  ELECTRS_API_URL: string = 'https://api.ordpool.space/api';
}

export function validate(config: Record<string, unknown>) {
  // Kein enableImplicitConversion: es würde Boolean-Env-Strings ("false") per
  // Truthiness zu true machen. Explizite @Transform-Decorators (z. B. PORT) machen
  // die Typkonvertierung korrekt und sichtbar.
  const validated = plainToClass(EnvironmentVariables, config);

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
