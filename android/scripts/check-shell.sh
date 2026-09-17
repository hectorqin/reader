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
#
#    There are two interfaces, not one. `ReaderAndroid` is the top-level object;
#    `SpeechBridge` is registered as a *separate* interface on the platform side
#    (`addJavascriptInterface` can expose objects, not properties of one) and the
#    web layer re-parents it onto `ReaderAndroid.speech`. So the check walks both
#    declarations against both implementations — comparing the nested interface's
#    methods against `ReaderBridge.kt` is what produced eleven false failures the
#    first time this was run.
note "==> checking the JS bridge contract in both directions"
bridge_file="$android_dir/app/src/main/java/cool/cnb/reader/bridge/ReaderBridge.kt"
speech_file="$android_dir/app/src/main/java/cool/cnb/reader/bridge/SpeechBridge.kt"
types_file="$repo_dir/web/src/android-bridge.d.ts"

# A method is "implemented" if either bridge class has it at method indentation.
# Both files are searched for both interfaces: the Kotlin class a method happens
# to live in is an implementation detail, not part of the contract.
implemented=$(sed -n 's/^    fun \([A-Za-z][A-Za-z0-9_]*\)(.*/\1/p' "$bridge_file" "$speech_file" | sort -u)

# The declaration side has two shapes, and the difference matters:
#
#   - top-level members are `name(args): type;` inside `interface AndroidBridge`;
#   - `speech` is a *property* whose type is a nested interface, and the nested
#     interface's own methods are the second shape.
#
# Reading only the first shape is what let the speech methods go unchecked; reading
# only the second is what made an early version of this check fail on every
# ordinary method of the first.
declared_top=$(sed -n 's/^  \([a-z][A-Za-z0-9_]*\)[?]\{0,1\}(.*/\1/p' "$types_file" | sort -u)
# The nested interface's members, delimited by its own declaration.
nested_block=$(sed -n '/^export interface SpeechBridge {/,/^}/p' "$types_file")
declared_nested=$(printf '%s\n' "$nested_block" | sed -n 's/^  \([a-z][A-Za-z0-9_]*\)[?]\{0,1\}(.*/\1/p' | sort -u)

for method in $declared_top $declared_nested; do
  if ! printf '%s\n' "$implemented" | grep -qx "$method"; then
    err "android-bridge.d.ts declares $method() but no bridge class implements it"
  fi
done

# The nested interface must be exposed, or the re-parenting in
# `promoteSpeechInterface` would attach nothing at runtime.
if printf '%s\n' "$declared_top" | grep -qx "speech"; then
  if ! grep -q '^    fun speech()' "$bridge_file"; then
    err "android-bridge.d.ts declares ReaderAndroid.speech but ReaderBridge.kt does not expose it"
  fi
fi

# Every implemented method must also be declared, or the next person writing
# client code will not know it is available. `speech()` is the exception: it is
# declared as the nested interface's name, not as a method returning one.
for method in $implemented; do
  [ "$method" = "speech" ] && continue
  if ! printf '%s\n%s\n' "$declared_top" "$declared_nested" | grep -qx "$method"; then
    err "a bridge class implements $method() but android-bridge.d.ts does not declare it"
  fi
done

# 4. The render-mode split has to agree with itself across three languages.
#
#    The whole "EPUB in the WebView, fixed pages natively" decision rests on the
#    client labelling a page as `image`/`document`/`reflowable` and the shell
#    accepting exactly the ones it can draw. Nothing type-checks that, and a
#    mismatch fails in the worst way: every page silently falls back to the slow
#    path, or a page is handed to a view that cannot decode it.
note "==> checking the render-mode vocabulary matches"
web_modes=$(sed -n "s/^export type RenderMode = \(.*\);/\1/p" "$repo_dir/web/src/formats/types.ts" \
  | tr -d "'" | tr -d ' ' | tr '|' '\n' | sort -u)
shell_modes=$(sed -n 's/.*mode != "\([a-z]*\)".*/\1/p' \
  "$android_dir/app/src/main/java/cool/cnb/reader/bridge/ReaderBridge.kt" | sort -u)
if [ -z "$web_modes" ]; then
  err "cannot read RenderMode from web/src/formats/types.ts"
fi
for mode in $shell_modes; do
  if ! printf '%s\n' "$web_modes" | grep -qx "$mode"; then
    err "ReaderBridge.kt branches on render mode '$mode' which RenderMode does not define"
  fi
done
# The shell draws images natively, so it must know the client's image vocabulary.
decodable=$(sed -n '/private val DECODABLE = setOf(/,/)/p' \
  "$android_dir/app/src/main/java/cool/cnb/reader/web/NativePageView.kt" \
  | sed -n 's/.*"\(image\/[a-z]*\)".*/\1/p' | sort -u)
for mediaType in "image/jpeg" "image/png" "image/webp"; do
  if ! printf '%s\n' "$decodable" | grep -qx "$mediaType"; then
    err "NativePageView cannot decode $mediaType, which the client routinely produces"
  fi
done

if [ "$fail" -ne 0 ]; then
  note "==> shell checks failed"
  exit 1
fi
note "==> shell checks passed"
