# Stage 1: Build
FROM oven/bun:latest AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=http://187.124.12.194:3200

RUN bun run build

# Stage 2: Serve
FROM oven/bun:latest

WORKDIR /app

RUN bun add serve

COPY --from=builder /app/dist ./dist

EXPOSE 3100

CMD ["bunx", "serve", "-s", "dist", "-l", "3100"]