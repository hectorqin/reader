/**
 * Declarations for `path.mjs`, following the same convention as `paths.d.mts`:
 * the build scripts stay plain JavaScript and this states the shape the test
 * consumes.
 */

/** Flattens an SVG path string into polylines of `[x, y]` points. */
export function pathToSubpaths(d: string): Array<Array<[number, number]>>;
