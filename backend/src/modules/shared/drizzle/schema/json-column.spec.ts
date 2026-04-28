import { jsonColumn } from './json-column';

describe('jsonColumn (mysql2 JSON parsing fix)', () => {
  // Drizzle's customType returns a builder that, when called, exposes the
  // shape we configured via { dataType, toDriver, fromDriver }. Pull those
  // out via the internal `config` field — this is what the Drizzle column
  // does at runtime when round-tripping a row.
  const helper = jsonColumn<string[]>();
  const built = helper('test') as unknown as {
    config: {
      customTypeParams: {
        toDriver: (v: string[]) => string;
        fromDriver: (v: unknown) => string[];
      };
    };
  };
  const { toDriver, fromDriver } = built.config.customTypeParams;

  test('toDriver stringifies arrays for MariaDB JSON columns', () => {
    expect(toDriver(['#555555', '#222222'])).toBe('["#555555","#222222"]');
    expect(toDriver([])).toBe('[]');
  });

  test('fromDriver parses the JSON string mysql2 returns under prepared statements', () => {
    expect(fromDriver('["#555555","#222222"]')).toEqual(['#555555', '#222222']);
    expect(fromDriver('[]')).toEqual([]);
  });

  test('fromDriver passes already-parsed arrays through (defensive: real MySQL with non-prepared queries)', () => {
    const arr = ['#abc'];
    expect(fromDriver(arr)).toBe(arr);
  });
});
