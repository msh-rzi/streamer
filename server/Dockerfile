FROM node:22-alpine AS build

WORKDIR /app

COPY package.json ./
COPY bun.lock ./

RUN npm install

COPY . .

RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY bun.lock ./

RUN npm install --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 3200

CMD ["node", "dist/main"]
