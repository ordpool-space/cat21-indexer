/**
 * Paginates an array based on items per page and the current page.
 *
 * @param array - The array to paginate.
 * @param itemsPerPage - The number of items per page.
 * @param currentPage - The current page number, starting at 1.
 * @returns The paginated slice of the array.
 */
export function paginateArray(array, itemsPerPage, currentPage) {
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  return array.slice(startIndex, endIndex);
}
