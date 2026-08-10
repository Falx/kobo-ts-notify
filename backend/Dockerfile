# Kobo Deal Notifier — backend image (NestJS API + daily scheduler)
# Build tools included only in the build stage so better-sqlite3 can compile
# native bindings if no prebuilt binary is available for the platform.

# ---- build stage ----
FROM node:24-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Drop dev-only packages from the dependency tree before shipping.
RUN npm prune --omit=dev

# ---- runtime stage ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Persistent state: tokens.json + SQLite (kobo.db) + dry-run summaries.
VOLUME /app/data

# Run as the non-root 'node' user that ships with the official image.
USER node

EXPOSE 3000
CMD ["node", "dist/main.js"]