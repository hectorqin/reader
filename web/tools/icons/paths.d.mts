/**
 * Types for the icon source paths.
 *
 * The generator is plain JavaScript on purpose — it runs under `node` directly, with
 * no build step, so that regenerating the font needs nothing but `npm install`. This
 * declaration is what lets the test suite import the same data with a type.
 */
export declare const GLYPHS: Record<string, string>;
