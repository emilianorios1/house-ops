FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate
COPY tsconfig.json next.config.ts postcss.config.mjs ./
COPY src/app ./src/app
COPY src/auth.ts ./src/auth.ts
COPY src/components ./src/components
COPY src/lib ./src/lib
COPY scripts/migrate.ts scripts/seed.ts scripts/import-legacy.ts scripts/import-pdf.ts scripts/import-records.ts scripts/import-handoff.ts scripts/smoke-production.mjs ./scripts/
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/emilianorios1/house-ops"
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# The same immutable image also runs forward-only migrations and one-time import.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/lib ./src/lib
COPY --from=build /app/package.json ./
USER node
EXPOSE 8000
CMD ["node", "server.js"]
