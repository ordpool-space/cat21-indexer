import { plainToClass, Transform } from 'class-transformer';
import {
  IsIn,
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

  /**
   * Bitcoin network this deployment targets. Prod defaults to
   * mainnet. Regtest CI overrides via `BACKEND_NETWORK=regtest` so
   * signed listings + posted bids with `network: 'regtest'` pass the
   * DTO's `network-mismatch` gate.
   *
   * The listings + bids services read this to decide which DTO
   * `network` value to accept. Any other network value is rejected
   * up-front with code `network-mismatch`.
   */
  @IsString()
  @IsIn(['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'])
  BACKEND_NETWORK: 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest' = 'mainnet';
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
