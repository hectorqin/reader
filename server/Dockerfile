# --- web build stage ---------------------------------------------------------
# Building the H5 client into the image is what makes 「一条命令跑起来」 apply to
# the reader as well as the API: the user starts the container and `/` is already
# a complete reading client, with no second deployment and no CORS to configure.
#
# The stage is separate so the frontend toolchain (Vite and its dependencies)
# never reaches the runtime image, which is what keeps the image near 150MB
# instead of a few hundred.
FROM docker.cnb.cool/dockerhub/node:24-alpine AS web
WORKDIR /web

COPY web/package.json web/package-lock.json* ./
RUN npm ci

COPY web/tsconfig.json web/vite.config.ts web/index.html ./
COPY web/src ./src
# A build failure here must fail the image: a server that boots without a client
# would look like a successful deploy and serve a landing page instead of a
# reader.
RUN npm run build


# --- server build stage ------------------------------------------------------
FROM docker.cnb.cool/dockerhub/node:24-alpine AS build
WORKDIR /app

COPY server/package.json server/package-lock.json* ./
# Install dev deps too: the TypeScript toolchain is needed to compile.
RUN npm ci --include=dev

COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src
RUN npm run build

# Strip dev dependencies for the runtime image.
RUN npm prune --omit=dev


# --- runtime stage -----------------------------------------------------------
FROM docker.cnb.cool/dockerhub/node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    BOOKS_DIR=/books \
    DATA_DIR=/data \
    PORT=8080 \
    WEB_DIR=/app/public

# Run as an unprivileged user. The library mount is read-only, so this user
# only ever needs write access to /data.
RUN addgroup -S reader && adduser -S reader -G reader \
 && mkdir -p /data /books /app/public && chown -R reader:reader /data /books /app/public

COPY --from=build --chown=reader:reader /app/node_modules ./node_modules
COPY --from=build --chown=reader:reader /app/dist ./dist
COPY --from=web --chown=reader:reader /web/dist ./public
COPY --chown=reader:reader server/package.json ./

USER reader
EXPOSE 8080
VOLUME ["/data"]

# The healthcheck hits the unauthenticated endpoint so an orchestrator can tell
# "server up but library unreadable" from "server down".
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
