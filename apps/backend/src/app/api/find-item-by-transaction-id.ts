/**
 * Finds an item by transactionId in an array and returns the item, as well as the previous and next items.
 * The item are expected to be in descending order [3,2,1]
 * If 2 is the current, then 3 is supposed to be the next, and 1 is supposed to be the previous
 *
 * @param array - The array of items with an 'transactionId' property.
 * @param transactionId - The transactionId of the item to find.
 * @returns An object with the previous, current, and next items.
 */
export function findItemByTransactionId<T extends { transactionId: string }>(
  array: T[],
  transactionId: string
): { previous: T | null; current: T | null; next: T | null } {

  const index = array.findIndex(item => item.transactionId === transactionId);

  if (index === -1) {
    return { previous: null, current: null, next: null };
  }

  const previous = index < array.length - 1 ? array[index + 1] : null;
  const current = array[index];
  const next = index > 0 ? array[index - 1] : null;

  return { previous, current, next };
}
