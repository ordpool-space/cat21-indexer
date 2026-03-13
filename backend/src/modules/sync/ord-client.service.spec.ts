import { OrdClientService } from './ord-client.service';

const BASE_URL = 'https://ord.test';

function createService(): OrdClientService {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(BASE_URL),
  } as any;
  return new OrdClientService(configService);
}

describe('OrdClientService', () => {
  let service: OrdClientService;

  beforeEach(() => {
    service = createService();
    jest.restoreAllMocks();
  });

  describe('getCat', () => {
    it('should return cat detail for a valid cat number', async () => {
      const mockCat = {
        id: 'abc123i0',
        number: 0,
        address: 'bc1p...',
        sat: 596964966600565,
        fee: 40834,
        height: 824205,
        timestamp: 1704315886,
        value: 546,
        weight: 705,
      };

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockCat),
      } as any);

      const result = await service.getCat(0);
      expect(result).toEqual(mockCat);
      expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/cat/0`, {
        headers: { Accept: 'application/json' },
      });
    });

    it('should return null for 404', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as any);

      const result = await service.getCat(999999);
      expect(result).toBeNull();
    });

    it('should throw on non-404 errors', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as any);

      await expect(service.getCat(0)).rejects.toThrow('ord API error: 500');
    });
  });

  describe('getLatestCatNumber', () => {
    it('should return the number of the newest cat', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');

      // First call: /cats page
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ids: ['abc123i0', 'def456i0'] }),
      } as any);

      // Second call: /cat/abc123i0 detail
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'abc123i0', number: 63731 }),
      } as any);

      const result = await service.getLatestCatNumber();
      expect(result).toBe(63731);
    });

    it('should return -1 when no cats exist', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ids: [] }),
      } as any);

      const result = await service.getLatestCatNumber();
      expect(result).toBe(-1);
    });
  });

  describe('getBlockHash', () => {
    it('should return block hash for a given height', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hash: '000000000000000000018e3ea447b1' }),
      } as any);

      const result = await service.getBlockHash(824205);
      expect(result).toBe('000000000000000000018e3ea447b1');
    });

    it('should throw on error', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as any);

      await expect(service.getBlockHash(999999999)).rejects.toThrow('ord API error: 404');
    });
  });
});
