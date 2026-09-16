Placeholder so a clean checkout can be built.

`scripts/build-web-assets.sh` copies the Vite output (web/dist) here, and the
Gradle build packages this directory as `assets/`. Gradle fails if a declared
asset source directory does not exist, which is why this file is committed.
