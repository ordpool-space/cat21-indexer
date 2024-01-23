import { CatService } from './cat.service';
import { Cat21 } from '../types/cat21';

describe('CatService', () => {
  let catService: CatService;
  let mockCats: Cat21[];

  beforeEach(() => {
    // Initialize CatService with a mock array of Cat21 objects
    mockCats = [
      { sat: 100 }, // 0
      { sat: 200 }, // 1
      { sat: 300 }, // 2
      { sat: 400 }  // 3
    ] as Cat21[];

    catService = new CatService({} as any, {} as any, {} as any);
    catService['cats'] = mockCats;
  });

  it('should find cats within a single sat range', async () => {
    const satRanges: [number, number][] =  [[150, 250]];
    const results = await catService.findCatsBySatRanges(satRanges);
    expect(results).toEqual([mockCats[1]]); // Should return the cat with sat 200
  });

  it('should find cats within multiple sat ranges', async () => {
    const satRanges: [number, number][] =  [[50, 150], [350, 450]];
    const results = await catService.findCatsBySatRanges(satRanges);
    expect(results).toEqual([mockCats[0], mockCats[3]]); // Should return the cats with sat 100 and 400
  });

  it('should return an empty array if no cats match the sat range', async () => {
    const satRanges: [number, number][] =  [[500, 600]];
    const results = await catService.findCatsBySatRanges(satRanges);
    expect(results).toEqual([]);
  });

  it('should handle edge cases where sat equals the boundaries of the range', async () => {
    const satRanges: [number, number][] =  [[200, 300]];
    const results = await catService.findCatsBySatRanges(satRanges);
    expect(results).toEqual([mockCats[1], mockCats[2]]); // Should return the cats with sat 200 and 300
  });
});
