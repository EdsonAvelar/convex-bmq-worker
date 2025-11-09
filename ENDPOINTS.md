# 📍 Endpoints do Worker - Referência Rápida

Base URL: `http://localhost:3002/queue` (desenvolvimento)

## 🚀 Endpoints Principais

### 1. Adicionar Webhook na Fila

```bash
POST /queue/webhooks/add

# Exemplo:
curl -X POST http://localhost:3002/queue/webhooks/add \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": 1,
    "integrationId": 5,
    "integrationName": "Webhook Venda",
    "negocioId": 12345,
    "url": "https://erp.example.com/webhook",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer token",
      "Content-Type": "application/json"
    },
    "body": {
      "event": "venda.fechada",
      "data": { ... }
    }
  }'

# Resposta (202 Accepted):
{
  "success": true,
  "jobId": "123",
  "message": "Webhook job accepted for processing"
}
```

### 2. Estatísticas da Fila

```bash
GET /queue/webhooks/stats

# Exemplo:
curl http://localhost:3002/queue/webhooks/stats

# Resposta:
{
  "queue": "webhooks",
  "counts": {
    "waiting": 5,
    "active": 2,
    "completed": 100,
    "failed": 3,
    "delayed": 0
  },
  "timestamp": "2025-11-03T..."
}
```

## 🏥 Endpoints de Saúde

Além dos caminhos com prefixo `/queue/*`, estão disponíveis aliases sem prefixo para compatibilidade com plataformas e testes externos.

### 3. Health Check

```bash
GET /queue/health
GET /health  # alias

# Exemplo:
curl http://localhost:3002/queue/health

# Resposta (200 = healthy, 503 = unhealthy):
{
  "status": "healthy",
  "uptime": 12345,
  "workers": {
    "webhook": {
      "active": true,
      "paused": false
    }
  },
  "redis": {
    "connected": true,
    "rtt_ms": 5
  },
  "timestamp": "2025-11-03T..."
}
```

### 4. Readiness Check

```bash
GET /queue/ready
GET /ready  # alias

# Exemplo:
curl http://localhost:3002/queue/ready

# Resposta:
{"ready": true}
```

### 5. Liveness Check

```bash
GET /queue/live
GET /live  # alias

# Exemplo:
curl http://localhost:3002/queue/live

# Resposta:
{"alive": true}
```

### 6. Raiz

```bash
GET /

# Resposta:
{
  "service": "convex-bmq-worker",
  "status": "ok",
  "endpoints": ["/health", "/ready", "/live", "/metrics", "/queue/webhooks/add"],
  "timestamp": "2025-11-05T..."
}
```

---

## 🌐 URLs por Ambiente

| Ambiente           | Base URL                                   | Exemplo                                                 |
| ------------------ | ------------------------------------------ | ------------------------------------------------------- |
| **Local**          | `http://localhost:3002/queue`              | `http://localhost:3002/queue/webhooks/add`              |
| **Railway**        | `https://seu-service.up.railway.app/queue` | `https://seu-service.up.railway.app/queue/webhooks/add` |
| **Docker Compose** | `http://worker:3002/queue`                 | `http://worker:3002/queue/webhooks/add`                 |

---

## 📝 Uso no Next.js

### Variável de Ambiente

```bash
# .env
WORKER_URL=http://localhost:3002/queue
```

### Código

```typescript
const response = await fetch(`${process.env.WORKER_URL}/webhooks/add`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tenantId: 1,
    integrationId: 5,
    url: "https://webhook.example.com",
    method: "POST",
    body: { event: "test" }
  })
});
```

---

## 🧪 Scripts de Teste

```bash
# Testar webhook simples
bash examples/test-simple.sh

# Testar webhook de venda fechada
bash examples/test-webhook.sh

# Health check
curl http://localhost:3002/queue/health

# Estatísticas
curl http://localhost:3002/queue/webhooks/stats
```

---

## ⚙️ Configuração Railway

No `railway.json`:

```json
{
  "deploy": {
    "healthcheckPath": "/queue/health"
  }
}
```

---

## 🐳 Docker Healthcheck

No `Dockerfile`:

```dockerfile
HEALTHCHECK CMD curl -fsS http://localhost:3002/queue/health || exit 1
```

No `docker-compose.yml`:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3002/queue/health"]
```
