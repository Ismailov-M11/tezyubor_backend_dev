# ---------- BUILD STAGE ----------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y openssl

# Copy package + prisma schema FIRST
COPY package*.json ./
COPY prisma ./prisma

RUN npm i

COPY . .

# Generate Prisma client
RUN npx prisma generate

# ---------- RUNTIME STAGE ----------
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y openssl

COPY package*.json ./
COPY prisma ./prisma

RUN npm i --omit=dev

COPY --from=builder /app ./

ENV NODE_ENV=production

RUN groupadd -r app && useradd -r -g app app

USER app

EXPOSE 5000

CMD ["node", "server.js"]