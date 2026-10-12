import { corsAllowedOrigins, DEFAULT_CORS_ORIGINS } from './cors-origins';

describe('corsAllowedOrigins', () => {
  it('with no extra origins answers exactly the production and dev-server origins', () => {
    expect(corsAllowedOrigins(undefined)).toEqual([
      'https://cat21.space',
      'https://ordpool.space',
      'http://localhost:4200',
      'http://localhost:4221',
    ]);
    expect(corsAllowedOrigins('')).toEqual([...DEFAULT_CORS_ORIGINS]);
  });

  it('adds each comma-separated extra origin, trimmed', () => {
    expect(corsAllowedOrigins(' http://localhost:4210 ,http://127.0.0.1:4210')).toEqual([
      ...DEFAULT_CORS_ORIGINS,
      'http://localhost:4210',
      'http://127.0.0.1:4210',
    ]);
  });

  it('lists an extra origin that is already a default once', () => {
    expect(corsAllowedOrigins('http://localhost:4200')).toEqual([...DEFAULT_CORS_ORIGINS]);
  });

  it.each([
    ['a trailing slash', 'http://localhost:4210/'],
    ['a path', 'http://localhost:4210/app'],
    ['no scheme', 'localhost:4210'],
    ['not a URL', 'not an origin'],
  ])('refuses an extra entry with %s', (_label, entry) => {
    expect(() => corsAllowedOrigins(entry)).toThrow(/CORS_EXTRA_ORIGINS/);
  });
});
