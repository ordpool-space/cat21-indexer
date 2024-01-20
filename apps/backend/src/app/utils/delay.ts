/**
 * Delays the execution for a given number of milliseconds. This function creates
 * a promise that resolves after the specified duration, effectively pausing
 * execution in an async function for the given duration when used with `await`.
 *
 * @param {number} ms - The number of milliseconds to delay.
 * @returns {Promise<void>} A promise that resolves after the specified delay.
 * @example
 * // Usage in an async function
 * async function example() {
 *   console.log('Wait starts');
 *   await delay(1000); // Wait for 1 second
 *   console.log('Wait ends');
 * }
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
