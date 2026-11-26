#!/bin/sh
# Creates the Android release keystore and stores it as the repository secrets
# release.yml signs the APK with. Run once, on your own machine (needs keytool,
# openssl and a gh login with admin rights on the repo):
#
#   sh scripts/android-signing-secrets.sh [owner/repo] [backup dir]
#
# Back up the backup dir (keystore + passwords): every future release must be
# signed with this key, or installed apps can no longer be upgraded.
set -eu

repo=${1:-hectorqin/reader}
dir=${2:-$HOME/reader-android-signing}
alias=reader-release

for tool in keytool openssl gh; do
  command -v "$tool" > /dev/null || { echo "missing: $tool" >&2; exit 1; }
done
[ ! -e "$dir/release.jks" ] || { echo "$dir/release.jks already exists; not overwriting" >&2; exit 1; }

umask 077
mkdir -p "$dir"
password=$(openssl rand -hex 24)
keytool -genkeypair -noprompt -keystore "$dir/release.jks" -storetype PKCS12 \
  -alias "$alias" -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$password" -keypass "$password" -dname "CN=Reader Pro"
printf 'keystore: %s\nalias: %s\npassword: %s\n' "$dir/release.jks" "$alias" "$password" > "$dir/passwords.txt"

base64 < "$dir/release.jks" | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64 -R "$repo"
printf '%s' "$password" | gh secret set ANDROID_KEYSTORE_PASSWORD -R "$repo"
printf '%s' "$alias" | gh secret set ANDROID_KEY_ALIAS -R "$repo"
gh secret list -R "$repo"
echo "Keystore and passwords saved in $dir - back this folder up somewhere safe."
