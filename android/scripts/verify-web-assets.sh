#!/bin/sh
# Proves that the staged web bundle is actually the one Gradle will pack.
#
# Why this is separate from build-web-assets.sh: that script knows one fact —
# where it writes the bundle. Gradle knows a second, independent fact — which
# directories count as assets. Nothing in the build connects them, and a mismatch
# fails in the quietest way possible: the APK builds successfully, ships with no
# client in it, and shows a blank screen on launch. Worse than a red build,
# because nothing points at it.
#
# The two facts have already drifted: `build.gradle.kts` declared
# `android/app/web-assets`, which no script ever wrote to, while the bundle went
# to `android/app/src/main/assets/web-assets` — and the placeholder the comment
# relied on had been deleted, so a clean checkout had no assets directory at all.
#
# Run after build-web-assets.sh in the same job; checks the staged output plus
# the Gradle declaration that consumes it.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
android_dir=$(dirname -- "$script_dir")
repo_dir=$(dirname -- "$android_dir")
dest="$android_dir/app/src/main/assets/web-assets"
gradle_file="$android_dir/app/build.gradle.kts"
fail=0

note() { printf '%s\n' "$1"; }
err() { printf 'FAIL: %s\n' "$1" >&2; fail=1; }

# 1. The bundle has to be there, and it has to be the built client rather than a
#    placeholder. An empty directory passes a naive existence check and still
#    produces a white-screen APK, which is exactly the case this guards.
note "==> checking the staged bundle exists"
if [ ! -d "$dest" ]; then
  err "$dest does not exist; build-web-assets.sh did not stage anything"
else
  if [ ! -f "$dest/index.html" ]; then
    err "$dest has no index.html; the APK would launch to a blank screen"
  fi

  # Vite emits the entry bundle at a path derived from vite.config.ts
  # (`entryFileNames: assets/client.js`). Matching that exact name means a change
  # to the bundler config shows up here instead of in a blank screen.
  if [ ! -f "$dest/assets/client.js" ]; then
    err "$dest/assets/client.js is missing; check entryFileNames in web/vite.config.ts"
  fi

  count=$(find "$dest" -type f ! -name 'README.txt' | wc -l | tr -d ' ')
  note "    staged files (excluding the placeholder): $count"
  if [ "$count" -lt 2 ]; then
    err "only $count real file(s) staged; expected the built client"
  fi
fi

# 2. Gradle must declare the directory the bundle was actually written to.
#    Comparing the literal path is the point: it catches a rename on either side,
#    which a build-time smoke test would not.
note "==> checking Gradle consumes that directory"
if ! grep -q '"src/main/assets/web-assets"' "$gradle_file"; then
  err "$gradle_file does not list src/main/assets/web-assets in assets.srcDirs; the staged bundle would be ignored"
fi

# 3. The placeholder has to be committed, or the directory is absent in a clean
#    checkout and assets.srcDirs silently points at nothing.
note "==> checking the assets directory is tracked"
if [ ! -f "$dest/README.txt" ]; then
  err "$dest/README.txt is missing; a clean checkout would have no assets directory"
fi
if ! git -C "$repo_dir" ls-files --error-unmatch \
     "android/app/src/main/assets/web-assets/README.txt" >/dev/null 2>&1; then
  err "the placeholder exists on disk but is not tracked by git; it will not survive a clone"
fi

if [ "$fail" -ne 0 ]; then
  note "==> web assets checks failed"
  exit 1
fi
note "==> web assets checks passed"
