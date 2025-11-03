# BullMQ Worker - Projeto Standalone para Railway

Worker BullMQ standalone para processamento de filas (webhooks, emails, notificações, etc). Deployável em Railway, VPS, Render, Fly.io ou qualquer runtime de containers.

## 🔒 Arquitetura de Segurança

**O worker NÃO tem acesso direto ao banco de dados!**

- ✅ Worker processa webhooks e envia logs via API interna
- ✅ Apenas 1 secret compartilhado (`INTERNAL_API_SECRET`)
- ✅ API route `/api/internal/webhook-logs` no Next.js persiste dados
- ✅ Railway não precisa de credenciais do banco
- ✅ Isolamento total de dados sensíveis

```
┌─────────────────┐          ┌──────────────────┐          ┌─────────────┐
│   Vercel App    │          │  Railway Worker  │          │  Database   │
│   (Next.js)     │─enqueue─▶│    (BullMQ)      │          │ (Supabase)  │
│                 │          │                  │          │             │
│  /api/internal/ │◀─logs────│  webhookWorker   │          │             │
│  webhook-logs   │          │  (POST to API)   │          │             │
│                 │          │                  │          │             │
│  basePrisma     │─────────saves logs────────────────────▶│             │
└─────────────────┘          └──────────────────┘          └─────────────┘
     ▲                              │
     │                              │
     └────shares INTERNAL_API_SECRET┘
```

## 📦 Estrutura do Projeto

```
worker_railway/
├── src/
│   ├── index.ts                  # Entrypoint principal
│   └── lib/
│       └── queue/
│           ├── connection.ts     # Conexão Redis (Upstash)
│           ├── BaseQueue.ts      # Classe base para filas
│           ├── BaseWorker.ts     # Classe base para workers
│           └── webhookWorker.ts  # Worker de webhooks (chama API)
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

# App URL (Next.js na Vercel) - OBRIGATÓRIO
APP_URL=https://your-app.vercel.app

# Secret compartilhado - OBRIGATÓRIO
# Gere um com: openssl rand -hex 32
INTERNAL_API_SECRET=your_super_secret_token_here

# Worker Config
NODE_ENV=production
PORT=3002
WORKER_CONCURRENCY=5
WORKER_LOCK_DURATION=120000
```

### 3. Configurar secret no Next.js (Vercel)

**IMPORTANTE**: O mesmo `INTERNAL_API_SECRET` deve estar na Vercel:

```bash
# Na Vercel (Settings → Environment Variables)
INTERNAL_API_SECRET=your_super_secret_token_here
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
curl http://localhost:3002/health

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
   - Adicione as variáveis (SEM `DATABASE_URL`!):
     ```
     UPSTASH_REDIS_REST_URL
     UPSTASH_REDIS_REST_TOKEN
     APP_URL=https://your-app.vercel.app
     INTERNAL_API_SECRET=your_super_secret_token_here
     NODE_ENV=production
     PORT=3002
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

| Variável                   | Obrigatório | Default      | Descrição                           |
| -------------------------- | ----------- | ------------ | ----------------------------------- |
| `UPSTASH_REDIS_REST_URL`   | ✅          | -            | URL do Upstash Redis                |
| `UPSTASH_REDIS_REST_TOKEN` | ✅          | -            | Token do Upstash Redis              |
| `APP_URL`                  | ✅          | -            | URL do Next.js (Vercel)             |
| `INTERNAL_API_SECRET`      | ✅          | -            | Secret compartilhado (min 32 chars) |
| `NODE_ENV`                 | ❌          | `production` | Ambiente de execução                |
| `PORT`                     | ❌          | `3002`       | Porta do health server              |
| `WORKER_CONCURRENCY`       | ❌          | `5`          | Jobs simultâneos                    |
| `WORKER_LOCK_DURATION`     | ❌          | `120000`     | Lock duration em ms                 |
| `TZ`                       | ❌          | `UTC`        | Timezone                            |

### 🔐 Gerar INTERNAL_API_SECRET seguro

```bash
# Linux/Mac
openssl rand -hex 32

# Windows (PowerShell)
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | % {[char]$_})

# Exemplo de secret forte:
# a7f3e9b2c8d4f1a6e5b9c3d7f2a8e4b6c9d5f1a3e7b2c8d4f6a9e3b7c1d5f8a2
```

**IMPORTANTE**: Use o mesmo secret na Vercel e no Railway!

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

# Deve mostrar: "Health server listening on port 3002"
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

docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' redis
