# --- build stage -------------------------------------------------------------
FROM docker.cnb.cool/dockerhub/node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
# Install dev deps too: the TypeScript toolchain is needed to compile.
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Strip dev dependencies for the runtime image.
RUN npm prune --omit=dev

# --- runtime stage -----------------------------------------------------------
FROM docker.cnb.cool/dockerhub/node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    BOOKS_DIR=/books \
    DATA_DIR=/data \
    PORT=8080

# Run as an unprivileged user. The library mount is read-only, so this user
# only ever needs write access to /data.
RUN addgroup -S reader && adduser -S reader -G reader \
 && mkdir -p /data /books && chown -R reader:reader /data /books

COPY --from=build --chown=reader:reader /app/node_modules ./node_modules
COPY --from=build --chown=reader:reader /app/dist ./dist
COPY --chown=reader:reader package.json ./

USER reader
EXPOSE 8080
VOLUME ["/data"]

# The healthcheck hits the unauthenticated endpoint so an orchestrator can tell
# "server up but library unreadable" from "server down".
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
