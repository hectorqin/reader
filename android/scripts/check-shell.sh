#!/bin/sh
# Static checks on the Android shell that do not need a JDK or the Android SDK.
#
# CI compiles the shell for real, but that job needs a large SDK image and takes
# minutes. This runs in a second, so a typo in a package declaration or a bridge
# method that the web client calls but the shell does not expose is caught before
# anyone waits for a build — which matters more than usual here, because the two
# halves of the bridge are written in different languages and cannot be
# type-checked against each other.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
android_dir=$(dirname -- "$script_dir")
repo_dir=$(dirname -- "$android_dir")
fail=0

note() { printf '%s\n' "$1"; }
err() { printf 'FAIL: %s\n' "$1" >&2; fail=1; }

# 1. Package declaration must match the file's directory under src/main/java.
note "==> checking package declarations match directory layout"
for file in $(find "$android_dir/app/src" -name '*.kt'); do
  pkg=$(sed -n 's/^package \(.*\)$/\1/p' "$file" | head -1)
  rel=${file#"$android_dir"/app/src/main/java/}
  expected=$(dirname "$rel" | tr '/' '.')
  if [ "$pkg" != "$expected" ]; then
    err "$file declares '$pkg' but lives in '$expected'"
  fi
done

# 2. Every import of our own code must resolve to a file that exists.
note "==> checking project imports resolve"
for file in $(find "$android_dir/app/src" -name '*.kt'); do
  sed -n 's/^import cool\.cnb\.reader\.\(.*\)$/\1/p' "$file" | while read -r symbol; do
    # `BuildConfig` is generated, and a class name is the last dot segment.
    case "$symbol" in
      BuildConfig) continue ;;
    esac
    path="$android_dir/app/src/main/java/cool/cnb/reader/$(printf '%s' "$symbol" | tr '.' '/').kt"
    if [ ! -f "$path" ]; then
      err "$file imports cool.cnb.reader.$symbol but $path does not exist"
    fi
  done
done

# 3. Every bridge method the web client calls must exist, and every bridge method
#    the shell exposes must be declared. This is the cross-language seam.
note "==> checking the JS bridge contract in both directions"
bridge_file="$android_dir/app/src/main/java/cool/cnb/reader/bridge/ReaderBridge.kt"
declared=$(sed -n 's/^    fun \([A-Za-z][A-Za-z0-9_]*\)(.*/\1/p' "$bridge_file" | sort -u)
types_file="$repo_dir/web/src/android-bridge.d.ts"
consumed=$(sed -n 's/^  \([a-z][A-Za-z0-9_]*\)[?]\?(.*:.*;.*$/\1/p' "$types_file" | sort -u)

for method in $consumed; do
  if ! printf '%s\n' "$declared" | grep -qx "$method"; then
    err "web client calls ReaderAndroid.$method() but ReaderBridge.kt does not declare it"
  fi
done

# Every bridge method must also appear in the client-facing declaration, or the
# next person writing client code will not know it is available.
missing_from_types=0
for method in $declared; do
  if ! printf '%s\n' "$consumed" | grep -qx "$method"; then
    err "ReaderBridge.$method exists but is missing from android-bridge.d.ts"
    missing_from_types=1
  fi
done
[ "$missing_from_types" -eq 0 ] || true

if [ "$fail" -ne 0 ]; then
  note "==> shell checks failed"
  exit 1
fi
note "==> shell checks passed"
