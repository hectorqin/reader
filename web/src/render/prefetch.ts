/**
 * Neighbour prefetching: whether to fetch the next section while this one is read.
 *
 * The reader's perceived speed is almost entirely about whether the next thing the
 * user does is already in memory. Turning onto a comic's next page or a serial's next
 * chapter is predictable one step ahead, and on a phone in a tunnel every one of them
 * would otherwise be a round trip. `ReaderView.open` fetches exactly one section
 * ahead (a staged book's section loads are shared, so the page turn that catches up
 * with a prefetch does not fetch twice); this decides whether to do it at all.
 */

/**
 * Whether prefetching is welcome.
 *
 * `saveData` is an explicit request from the user and is honoured as one. A 2G
 * connection is not going to finish a prefetch before the reader wants the item,
 * so the bandwidth is better left for the foreground.
 */
export function shouldPrefetch(): boolean {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}
