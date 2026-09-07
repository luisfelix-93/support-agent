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

# Copiar dependências de produção com permissão para o usuário node
COPY --chown=node:node --from=runner-deps /app/node_modules ./node_modules
# Copiar o código transpilado
COPY --chown=node:node --from=builder /app/dist ./dist
# Copiar package.json
COPY --chown=node:node --from=builder /app/package.json ./package.json

# Executa container com usuário não-privilegiado (UID 1000 padrão do Alpine node)
USER node

EXPOSE 3000 9090

# Sinal padrão para encerramento gracioso
STOPSIGNAL SIGTERM

# Health check periódico da aplicação
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["npm", "start"]

