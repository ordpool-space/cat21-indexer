import { SCHEDULE_INTERVAL_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { DEFAULT_SYNC_INTERVAL_MS, readSyncIntervalMsFromEnv } from './sync-interval';

describe('readSyncIntervalMsFromEnv', () => {
  it('ticks once a minute when SYNC_INTERVAL_MS is unset or empty', () => {
    expect(DEFAULT_SYNC_INTERVAL_MS).toBe(60_000);
    expect(readSyncIntervalMsFromEnv({})).toBe(60_000);
    expect(readSyncIntervalMsFromEnv({ SYNC_INTERVAL_MS: '' })).toBe(60_000);
  });

  it('takes SYNC_INTERVAL_MS in milliseconds', () => {
    expect(readSyncIntervalMsFromEnv({ SYNC_INTERVAL_MS: '2000' })).toBe(2000);
  });

  it.each(['0', '-5', '1.5', '2s', 'abc'])('refuses SYNC_INTERVAL_MS=%s', (raw) => {
    expect(() => readSyncIntervalMsFromEnv({ SYNC_INTERVAL_MS: raw })).toThrow(
      `SYNC_INTERVAL_MS is "${raw}", expected a positive integer of milliseconds`,
    );
  });
});

describe('SyncService tick', () => {
  const saved = process.env.SYNC_INTERVAL_MS;
  afterEach(() => {
    if (saved === undefined) delete process.env.SYNC_INTERVAL_MS;
    else process.env.SYNC_INTERVAL_MS = saved;
  });

  /** The interval @Interval registered on handleSync, read from a fresh module load. */
  function registeredTimeout(): unknown {
    let timeout: unknown;
    jest.isolateModules(() => {
      const { SyncService } = require('./sync.service') as typeof import('./sync.service');
      timeout = (Reflect.getMetadata(SCHEDULE_INTERVAL_OPTIONS, SyncService.prototype.handleSync) as { timeout: number }).timeout;
    });
    return timeout;
  }

  it('registers handleSync at SYNC_INTERVAL_MS', () => {
    process.env.SYNC_INTERVAL_MS = '1500';
    expect(registeredTimeout()).toBe(1500);
  });

  it('registers handleSync at the default without SYNC_INTERVAL_MS', () => {
    delete process.env.SYNC_INTERVAL_MS;
    expect(registeredTimeout()).toBe(60_000);
  });
});
