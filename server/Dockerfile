# --- web client build stage ---------------------------------------------------
# The H5 client is built here and baked into the server image, because serving it
# from the same container is what keeps the deployment to a single command: the
# reader opens http://<nas-ip>:8080 and gets the app, with no second container and
# no CORS configuration to think about.
#
# `web` is optional. When the build context has no `web` directory the copy below
# fails, so the client stage is gated behind a build arg and the runtime stage
# tolerates an absent bundle. A server-only deployment stays possible.
#
# The base image is overridable because `docker.cnb.cool` is an authenticated
# mirror: a plain `docker build` on a machine whose token has no pull rights on
# it fails at the very first stage. Docker Hub is the default; pass the mirror
# where it is reachable (CNB pipelines, or anywhere Hub is slow):
#
#   docker build . -f server/Dockerfile \
#     --build-arg NODE_IMAGE=docker.cnb.cool/dockerhub/node:24-alpine
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- server build stage ------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY server/package.json server/package-lock.json* ./
# Dev dependencies included: the TypeScript toolchain is needed to compile.
RUN npm ci --include=dev

COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src
RUN npm run build

# Strip dev dependencies for the runtime image.
RUN npm prune --omit=dev


# --- runtime stage -----------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    BOOKS_DIR=/books \
    DATA_DIR=/data \
    PORT=8080 \
    WEB_DIR=/app/web

# Run as an unprivileged user. The library mount is read-only, so this user only
# ever needs write access to /data.
#
# `su-exec` is a ~10KB static helper that drops privileges from an entrypoint;
# Alpine's busybox has no equivalent (`setpriv` lives in util-linux, which the
# base image does not carry), and `su` there needs a password hash to be set up.
RUN apk add --no-cache su-exec \
 && addgroup -S reader && adduser -S reader -G reader \
 && mkdir -p /data /books /app/public && chown -R reader:reader /data /books /app/public

COPY --from=build --chown=reader:reader /app/node_modules ./node_modules
COPY --from=build --chown=reader:reader /app/dist ./dist
COPY --from=build --chown=reader:reader /app/package.json ./
# The built H5 client, served by the same process at `/`.
COPY --from=web --chown=reader:reader /web/dist ./web

# The entrypoint starts as root purely to take ownership of the *mounted* /data
# (a bind mount's uid/gid comes from the host and overrides the chown above),
# then re-execs the server as `reader`. See the script for the full rationale.
COPY --chown=root:root server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080
VOLUME ["/data"]

# The healthcheck hits the unauthenticated endpoint so an orchestrator can tell
# "server up but library unreadable" from "server down".
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
