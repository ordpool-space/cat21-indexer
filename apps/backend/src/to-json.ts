import * as util from 'util';

/**
 * Save version of JSON.stringify,
 * it automatically replaces circular links with "[Circular]".
 */
export function toJson(object) {
  return util.inspect(object, false, 1, true);
}
