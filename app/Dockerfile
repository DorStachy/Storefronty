# Storefronty backend — the Node API + the portal SPA + the site-building pipeline (Playwright).
# Single-box deploy: this one container serves /api, the SPA, the 48h preview sites, the Stripe
# webhook, and the approval endpoint. Cheapest reliable v1 (Fly.io). The cera dev-gate does NOT
# apply inside the build — this is a clean container, so npm/playwright install normally.
FROM node:22-bookworm-slim

WORKDIR /app

# Install deps first (better layer caching). ci when the lockfile is in sync, else install (so adding
# a dep to package.json without regenerating the lock still builds).
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# The headless browser for the screenshotter + QA gate (+ its system libs).
RUN npx playwright install --with-deps chromium

COPY . .

ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/storefronty.db \
    HOSTING_ENGINE=local \
    CHROMIUM_NO_SANDBOX=1

VOLUME /data
EXPOSE 8080
CMD ["node", "--experimental-sqlite", "src/server.js"]
