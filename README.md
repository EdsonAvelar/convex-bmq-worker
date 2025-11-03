# BullMQ Worker - Projeto Standalone para Railway

Worker BullMQ standalone para processamento de filas (webhooks, emails, notificações, etc). Deployável em Railway, VPS, Render, Fly.io ou qualquer runtime de containers.

## 📦 Estrutura do Projeto

```
worker_railway/
├── src/
│   ├── index.ts                  # Entrypoint principal
│   ├── lib/
│   │   ├── db.ts                 # Prisma Client singleton
│   │   └── queue/
│   │       ├── connection.ts     # Conexão Redis (Upstash)
│   │       ├── BaseQueue.ts      # Classe base para filas
│   │       ├── BaseWorker.ts     # Classe base para workers
│   │       └── webhookWorker.ts  # Worker de webhooks
├── prisma/
│   └── schema.prisma             # Schema Prisma (modelos necessários)
├── Dockerfile                     # Imagem Docker otimizada
├── railway.json                   # Configuração Railway
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md (este arquivo)
```

## 🚀 Quick Start

### 1. Clonar e configurar

```bash
# Clonar o repositório (ou criar um novo)
git clone https://github.com/seu-usuario/convex-worker.git
cd convex-worker

# Instalar dependências
npm install

# Copiar .env.example para .env
cp .env.example .env

# Editar .env com suas credenciais
nano .env
```

### 2. Configurar variáveis de ambiente

Edite o arquivo `.env`:

```bash
# Redis (Upstash) - OBRIGATÓRIO
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here

# Database (PostgreSQL) - OBRIGATÓRIO
DATABASE_URL=postgresql://user:password@host:5432/database

# Worker Config
NODE_ENV=production
PORT=3001
WORKER_CONCURRENCY=5
WORKER_LOCK_DURATION=120000
```

### 3. Gerar Prisma Client

```bash
npm run db:generate
```

### 4. Testar localmente

```bash
# Modo desenvolvimento (com hot reload)
npm run dev

# Ou modo produção
npm start
```

### 5. Verificar saúde

```bash
# Em outro terminal
curl http://localhost:3001/health

# Resposta esperada:
{
  "status": "healthy",
  "uptime": 42,
  "workers": {
    "webhook": {
      "active": true,
      "paused": false
    }
  },
  "timestamp": "2025-11-03T..."
}
```

## 🚂 Deploy no Railway

### Opção 1: Via Dashboard (recomendado)

1. **Criar conta**: Acesse [railway.app](https://railway.app) e faça login com GitHub

2. **Novo projeto**: 
   - New Project → Deploy from GitHub repo
   - Selecione o repositório deste worker

3. **Configurar variáveis de ambiente**:
   - Vá em **Variables** no dashboard
   - Adicione todas as variáveis do `.env.example`:
     ```
     UPSTASH_REDIS_REST_URL
     UPSTASH_REDIS_REST_TOKEN
     DATABASE_URL
     NODE_ENV=production
     PORT=3001
     ```

4. **Deploy automático**:
   - Railway detecta o `Dockerfile` e faz build automaticamente
   - Acompanhe os logs na aba **Deployments**

5. **Verificar health**:
   ```bash
   curl https://your-service.up.railway.app/health
   ```

### Opção 2: Via Railway CLI

```bash
# Instalar Railway CLI
npm install -g @railway/cli

# Login
railway login

# Criar projeto
railway init

# Adicionar variáveis de ambiente
railway variables set UPSTASH_REDIS_REST_URL=https://...
railway variables set UPSTASH_REDIS_REST_TOKEN=...
railway variables set DATABASE_URL=postgresql://...

# Deploy
railway up

# Ver logs
railway logs
```

## 📊 Endpoints Disponíveis

### Health Check (Status Geral)
```bash
GET /health

# Resposta 200 (healthy) ou 503 (unhealthy)
{
  "status": "healthy",
  "uptime": 123,
  "workers": {...},
  "timestamp": "2025-11-03T..."
}
```

### Readiness (Railway/K8s)
```bash
GET /ready

# Resposta 200 se pronto para receber jobs
{"ready": true}
```

### Liveness (Railway/K8s)
```bash
GET /live

# Resposta 200 se processo está vivo
{"alive": true}
```

## 🔧 Scripts Disponíveis

```bash
# Desenvolvimento (hot reload)
npm run dev

# Produção
npm start

# Gerar Prisma Client
npm run db:generate

# Push schema para database
npm run db:push

# Health check
npm run health

# Teste de carga (futuro)
npm run test:load
```

## 📝 Variáveis de Ambiente

| Variável | Obrigatório | Default | Descrição |
|----------|-------------|---------|-----------|
| `UPSTASH_REDIS_REST_URL` | ✅ | - | URL do Upstash Redis |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | - | Token do Upstash Redis |
| `DATABASE_URL` | ✅ | - | PostgreSQL connection string |
| `DIRECT_URL` | ❌ | - | Database URL direto (sem pooling) |
| `NODE_ENV` | ❌ | `production` | Ambiente de execução |
| `PORT` | ❌ | `3001` | Porta do health server |
| `WORKER_CONCURRENCY` | ❌ | `5` | Jobs simultâneos |
| `WORKER_LOCK_DURATION` | ❌ | `120000` | Lock duration em ms |
| `TZ` | ❌ | `UTC` | Timezone |

## 🎯 Adicionando Novos Workers

### 1. Criar worker file

```typescript
// src/lib/queue/emailWorker.ts
import { Job } from "bullmq";
import { BaseWorker } from "./BaseWorker";

interface EmailJobData {
  tenantId: number;
  to: string;
  subject: string;
  body: string;
}

class EmailWorker extends BaseWorker<EmailJobData> {
  constructor() {
    super("emails", {
      concurrency: 10,
    });
  }

  protected async processJob(job: Job<EmailJobData>): Promise<any> {
    const { to, subject, body } = job.data;
    
    // Lógica de envio de email
    console.log(`📧 Enviando email para ${to}...`);
    
    return { sent: true };
  }
}

export const emailWorker = new EmailWorker();
```

### 2. Registrar no index.ts

```typescript
// src/index.ts
import { emailWorker } from "./lib/queue/emailWorker";

// Na função main(), após inicializar webhook worker:
log("info", "Initializing email worker...");
await emailWorker.waitUntilReady();
log("info", "Email worker ready");

// No gracefulShutdown(), adicionar:
await emailWorker.stop();
```

## 🐛 Troubleshooting

### Worker não inicia

```bash
# Ver logs detalhados
railway logs --follow

# Problemas comuns:
# 1. Variáveis de ambiente faltando
# 2. Redis inacessível
# 3. DATABASE_URL inválida
```

### Health check falha

```bash
# Verificar se porta está exposta
railway logs | grep "Health server listening"

# Deve mostrar: "Health server listening on port 3001"
```

### Jobs não processam

```bash
# 1. Verificar Redis conectado
railway logs | grep "Redis TCP"

# 2. Verificar se producer (Vercel) enfileirou job
# No Next.js: console.log('Job ID:', jobId)

# 3. Verificar worker recebeu job
railway logs | grep "Processing webhook"
```

### Erros de conexão Redis

```bash
# Verificar credenciais Upstash
railway logs | grep "UPSTASH"

# Testar conexão manual
curl -X POST https://your-redis.upstash.io \
  -H "Authorization: Bearer your_token" \
  -d '["PING"]'
```

## 💰 Custos Estimados (Railway)

- **Execução**: $0.000463/GB-hour
- **512 MB 24/7**: ~$5/mês
- **Tráfego egress**: $0.10/GB (~$1-2/mês)
- **Total estimado**: ~$6-7/mês

Para reduzir custos:
- Use 256 MB se processamento for leve
- Configure auto-scaling (desligar em horários ociosos)
- Otimize concorrência e timeouts

## 📚 Recursos

- [BullMQ Docs](https://docs.bullmq.io)
- [Railway Docs](https://docs.railway.app)
- [Upstash Redis](https://upstash.com/docs/redis)
- [Prisma Docs](https://www.prisma.io/docs)

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -m 'feat: adicionar nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

## 📄 Licença

MIT License - veja arquivo LICENSE para detalhes

## 🆘 Suporte

- **Issues**: Abra uma issue no GitHub
- **Railway Community**: [Discord](https://discord.gg/railway)
- **Email**: contato@convex.com

---

**Criado por**: Convex Team  
**Última atualização**: 03/11/2025  
**Versão**: 1.0.0
