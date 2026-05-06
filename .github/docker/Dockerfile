# ---------- BUILD STAGE ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package + prisma schema FIRST
COPY package*.json ./
COPY prisma ./prisma

RUN npm i

COPY . .

# Generate Prisma client
RUN npx prisma generate

# ---------- RUNTIME STAGE ----------
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

RUN npm i --omit=dev

COPY --from=builder /app ./

ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000

CMD ["node", "server.js"]