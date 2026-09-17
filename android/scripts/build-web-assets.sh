#!/bin/sh
# Builds the shared web client and stages it as Android assets.
#
# This script is the mechanism that keeps the Android and H5 clients from becoming
# two implementations: one Vite bundle, one host-agnostic web layer, two hosts.
#
# Run from anywhere; paths are resolved relative to the script.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
android_dir=$(dirname -- "$script_dir")
repo_dir=$(dirname -- "$android_dir")
web_dir="$repo_dir/web"
dest="$android_dir/app/src/main/assets/web-assets"

if [ ! -d "$web_dir" ]; then
  echo "web client not found at $web_dir" >&2
  exit 1
fi

echo "==> building web client"
cd "$web_dir"
# `npm ci` when a lockfile exists so a release build is reproducible; `install`
# otherwise so a first-time contributor is not blocked on generating one.
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
npm run build

echo "==> staging assets into $dest"
# Clear the previous bundle but keep README.txt. That file is tracked, and a
# blanket `rm -rf "$dest"` deletes it — leaving a dirty working tree after every
# build and turning `git status` into noise that hides real changes. It is also
# the only reason the directory exists in a clean checkout.
mkdir -p "$dest"
find "$dest" -mindepth 1 ! -name 'README.txt' -exec rm -rf {} +
# Only the built output. Copying the sources would ship the whole TypeScript tree
# inside the APK for no benefit.
cp -R "$web_dir/dist/." "$dest/"

echo "==> done"
echo "The Android build now packs $(find "$dest" -type f | wc -l | tr -d ' ') files as assets."
