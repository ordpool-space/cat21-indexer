import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool, Pool } from 'mysql2/promise';
import { drizzle, MySql2Database } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import * as schema from './schema';

@Injectable()
export class DrizzleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DrizzleService.name);
  private readonly pool: Pool;
  readonly db: MySql2Database<typeof schema>;

  constructor(configService: ConfigService) {
    const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
    this.pool = createPool(databaseUrl);
    this.db = drizzle(this.pool, { schema, mode: 'default' });
    this.logger.log('Database connection pool created');
  }

  async onModuleInit() {
    // Apply pending migrations before the app starts serving. Crashes the
    // process on failure — better than serving against a stale schema.
    // The migrations folder is shipped as ./migrations in the build artifact;
    // in dev (running from src via ts-node) it's at ../migrations relative to cwd.
    const candidates = ['./migrations', '../migrations'];
    const folder = candidates.find((p) => existsSync(join(process.cwd(), p)));
    if (!folder) {
      this.logger.warn('No migrations folder found; skipping drizzle migrate');
      return;
    }
    this.logger.log(`Applying drizzle migrations from ${folder}`);
    await migrate(this.db, { migrationsFolder: folder });
    this.logger.log('Drizzle migrations applied');
  }

  async onModuleDestroy() {
    await this.pool.end();
    this.logger.log('Database connection pool closed');
  }
}
