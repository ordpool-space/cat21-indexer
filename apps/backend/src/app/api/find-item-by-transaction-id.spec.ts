import { findItemByTransactionId } from './find-item-by-transaction-id';

describe('findItemByTransactionId', () => {
  const items = [
    { transactionId: '3' }, // newest item
    { transactionId: '2' }, //
    { transactionId: '1' }  // oldest item
  ];

  test('finds the correct item and neighbors', () => {
    const { next, previous, current } = findItemByTransactionId(items, '2');

    expect(next).toEqual({ transactionId: '3' });
    expect(current).toEqual({ transactionId: '2' });
    expect(previous).toEqual({ transactionId: '1' });
  });

  test('returns null for previous if the item is the oldest one', () => {
    const { next, previous, current } = findItemByTransactionId(items, '1');

    expect(next).toEqual({ transactionId: '2' });
    expect(current).toEqual({ transactionId: '1' });
    expect(previous).toBeNull();
  });

  test('returns null for next if the item is the newest one', () => {
    const { next, previous, current  } = findItemByTransactionId(items, '3');

    expect(next).toBeNull();
    expect(current).toEqual({ transactionId: '3' });
    expect(previous).toEqual({ transactionId: '2' });
  });

  test('returns null for all if the item is not found', () => {

    const { next, previous, current } = findItemByTransactionId(items, '999');

    expect(previous).toBeNull();
    expect(current).toBeNull();
    expect(next).toBeNull();
  });
});
