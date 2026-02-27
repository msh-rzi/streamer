FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile --no-cache --cache-dir=/tmp/bun-cache \
  && rm -rf /tmp/bun-cache

COPY . .

RUN bun run build

FROM nginx:alpine AS runner

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3100

CMD ["nginx", "-g", "daemon off;"]
