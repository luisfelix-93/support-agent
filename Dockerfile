# ─── Stage 1: Build compilado ────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ─── Stage 2: Instalação de dependências de prod ─────
FROM node:20-alpine AS runner-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Stage 3: Runner de produção ─────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copiar dependências de produção
COPY --from=runner-deps /app/node_modules ./node_modules
# Copiar o código transpilado
COPY --from=builder /app/dist ./dist
# Copiar package.json
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

CMD ["npm", "start"]
