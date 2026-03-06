FROM node:20-alpine AS builder

WORKDIR /app
# 统一使用 backend 目录作为构建上下文
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ===== 生产镜像 =====
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/db/schema.sql ./dist/db/schema.sql

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "dist/index.js"]
