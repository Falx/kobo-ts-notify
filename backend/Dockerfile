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

# Install Playwright browsers during build (has build tools for native deps)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium

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

# Install only the runtime deps Playwright needs (no build tools)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 \
    libasound2 libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libpango-1.0-0 libcairo2 libcups2 libxshmfence1 \
  && rm -rf /var/lib/apt/lists/*

# Copy Playwright browsers from build stage
COPY --from=build /ms-playwright /ms-playwright
RUN chown -R node:node /ms-playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Persistent state: tokens.json + SQLite (kobo.db) + dry-run summaries.
VOLUME /app/data

# Run as the non-root 'node' user that ships with the official image.
USER node

EXPOSE 3000
CMD ["node", "dist/main.js"]
