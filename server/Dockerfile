FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile --no-cache --cache-dir=/tmp/bun-cache \
  && rm -rf /tmp/bun-cache

COPY . .

RUN bun run build

FROM oven/bun:1-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile --production --no-cache --cache-dir=/tmp/bun-cache \
  && rm -rf /tmp/bun-cache

COPY --from=build /app/dist ./dist

EXPOSE 3200

CMD ["bun", "dist/src/main.js"]
