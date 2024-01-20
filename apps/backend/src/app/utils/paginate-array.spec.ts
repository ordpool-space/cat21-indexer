import { paginateArray } from './paginate-array'

describe("paginateArray function", function() {

  const testData = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("should return the correct slice for page 1", function() {
    const result = paginateArray(testData, 3, 1);
    expect(result).toEqual([1, 2, 3]);
  });

  it("should return the correct slice for page 2", function() {
    const result = paginateArray(testData, 3, 2);
    expect(result).toEqual([4, 5, 6]);
  });

  it("should return the correct slice for the last page with items less than itemsPerPage", function() {
    const result = paginateArray(testData, 3, 4);
    expect(result).toEqual([10]);
  });

  it("should return an empty array if the current page exceeds the total pages", function() {
    const result = paginateArray(testData, 3, 5);
    expect(result).toEqual([]);
  });

  it("should handle empty arrays", function() {
    const result = paginateArray([], 3, 1);
    expect(result).toEqual([]);
  });

});
