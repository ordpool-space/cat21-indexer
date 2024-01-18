export function formatSeconds(seconds: number) {
  const pad = function (s: number) {
    return (s < 10 ? '0' : '') + s;
  }
  const hours = Math.floor(seconds / (60 * 60));
  const minutes = Math.floor(seconds % (60 * 60) / 60);
  const secs = Math.floor(seconds % 60);

  return pad(hours) + ':' + pad(minutes) + ':' + pad(secs);
}
