# Dockerfile para BullMQ Worker (Railway)
# Multi-stage build otimizado - SEM acesso ao banco de dados

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
FROM node:20-alpine AS deps
WORKDIR /app

# Instalar dependências do sistema
RUN apk add --no-cache \
    libc6-compat \
    ca-certificates

# Copiar package files
COPY package*.json ./

# Instalar apenas prod dependencies
RUN npm ci --only=production

# ============================================================================
# Stage 2: Runner
# ============================================================================
FROM node:20-alpine AS runner
WORKDIR /app

# Instalar dependências runtime
RUN apk add --no-cache \
    libc6-compat \
    dumb-init \
    curl \
    ca-certificates

# Criar usuário não-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

# Copiar node_modules
COPY --from=deps --chown=worker:nodejs /app/node_modules ./node_modules

# Copiar source code
COPY --chown=worker:nodejs src ./src
COPY --chown=worker:nodejs package*.json ./
COPY --chown=worker:nodejs tsconfig.json ./

# Instalar tsx globalmente
RUN npm install -g tsx

# Configurar variáveis de ambiente
ENV NODE_ENV=production \
    PORT=3001 \
    TZ=UTC

USER worker

# Health check - ✅ Robusto com curl -fsS
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:3001/health || exit 1

# Expor porta
EXPOSE 3001

# Usar dumb-init para proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Comando para iniciar o worker
CMD ["tsx", "src/index.ts"]
