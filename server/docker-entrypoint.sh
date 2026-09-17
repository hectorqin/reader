#!/bin/sh
# Fix the ownership of the writable data directory before dropping privileges.
#
# Why this exists: the image runs as the unprivileged `reader` user, and the
# build-time `chown /data` is useless the moment `/data` is *mounted*. A bind
# mount (`./data:/data`) exposes the host directory's own uid/gid, which on Linux
# is almost always root:root — the chown baked into the image never applies to a
# mount, only to the image layer underneath it. Docker creates a *missing* bind
# source as root:root too, so the very common
#
#   docker compose up -d          # ./data does not exist yet
#
# lands on a root-owned `/data`, and the server then dies at boot with
#
#   EACCES: permission denied, open '/data/token.secret'
#
# because `loadOrCreateSecret` cannot write the signing key.
#
# Named volumes inherit the image's chown, so they were never affected — this
# only repairs bind mounts, and only the directory itself (not the whole tree),
# so a big library cache is not re-chowned on every restart.
#
# The entrypoint therefore stays root just long enough to take ownership of the
# single directory the server writes to, then `exec`s the server as `reader` so
# the long-running process keeps the unprivileged uid.
set -e

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # `chown` on the directory alone is enough: SQLite, the cover cache and the
  # secret are all created *inside* it by the server, which then owns them.
  # Failures are tolerated (e.g. a read-only data mount) so the server can still
  # start and report a clearer error of its own.
  chown reader:reader "$DATA_DIR" 2>/dev/null || true

  # Drop to the unprivileged user for the long-running process. `su-exec` is the
  # alpine-native equivalent of gosu; it sets uid/gid and exec's, so the server
  # keeps pid 1 and still receives SIGTERM (see main.ts shutdown handling).
  exec su-exec reader:reader "$@"
fi

# Already non-root (e.g. `docker run --user`): just run the command.
exec "$@"
