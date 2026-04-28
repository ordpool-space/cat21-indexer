import { customType } from 'drizzle-orm/mysql-core';

/**
 * MariaDB stores JSON columns internally as LONGTEXT, and the mysql2 driver
 * (under the prepared-statement protocol Drizzle uses) returns them as raw
 * strings. Drizzle's built-in mysql `json()` only handles serialization on
 * write (mapToDriverValue = JSON.stringify) but has NO matching parser on
 * read, so values flow through to the application as JSON strings instead
 * of arrays/objects.
 *
 * This customType closes the gap: `dataType: 'json'` keeps the SQL DDL
 * identical to Drizzle's built-in (so the existing migration stays valid),
 * `toDriver` stringifies on write, `fromDriver` parses on read.
 *
 * Usage: `jsonColumn<string[]>()('cat_colors').notNull().default([])`.
 */
export const jsonColumn = <T>() => customType<{ data: T; driverData: string }>({
  dataType() {
    return 'json';
  },
  toDriver(value: T): string {
    return JSON.stringify(value);
  },
  fromDriver(value: unknown): T {
    if (typeof value === 'string') {
      return JSON.parse(value) as T;
    }
    return value as T;
  },
});
