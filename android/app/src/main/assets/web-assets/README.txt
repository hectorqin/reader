This file exists so the directory it lives in is tracked by git.

Gradle's `assets.srcDirs` points at this directory, and a clean checkout has to
be buildable without first running the web build. The real bundle is written
here by android/scripts/build-web-assets.sh and is gitignored, so without a
placeholder the directory simply does not exist after `git clone`.
