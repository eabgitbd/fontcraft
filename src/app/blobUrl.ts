/** One object URL per Blob, created lazily and reused, so thumbnails do not leak URLs on every render. */
const cache = new WeakMap<Blob, string>();
export function blobUrl(blob: Blob): string {
  let url = cache.get(blob);
  if (!url) {
    url = URL.createObjectURL(blob);
    cache.set(blob, url);
  }
  return url;
}
