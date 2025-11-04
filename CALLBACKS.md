# 🎉 Sistema de Callbacks - Implementação Completa

## ✅ Resumo das Mudanças

**Objetivo:** Adicionar sistema de callbacks HTTP padronizado para notificar o Next.js sobre resultados de jobs processados.

**Status:** ✅ **IMPLEMENTADO COM SUCESSO**

---

## 📦 Arquivos Criados

### 1. **`src/lib/types.ts`** (NOVO)

Interfaces TypeScript padronizadas:

- `QueueJobPayload` - Payload para enfileirar jobs
- `WorkerCallbackPayload` - Payload de callback após processar job
- `QueueEnqueueResponse` - Resposta ao enfileirar

### 2. **`src/lib/callbackSender.ts`** (NOVO)

Módulo responsável por enviar callbacks:

- ✅ Envia com Bearer Token no header `Authorization`
- ✅ Retry automático com exponential backoff (3 tentativas)
- ✅ Timeout de 10s por tentativa
- ✅ Logging estruturado JSON

---

## 🔧 Arquivos Modificados

### 3. **`src/lib/queue/webhookWorker.ts`** (ATUALIZADO)

**Mudanças:**

- ✅ `WebhookJobData` agora suporta **formato antigo E novo**
- ✅ `integrationId` agora é **opcional** (para emails, SMS, etc)
- ✅ Adicionado suporte a `destination` e `callback`
- ✅ Worker envia callback **após sucesso**
- ✅ Worker envia callback **após erro/retry**
- ✅ `saveWebhookLog` aceita `integrationId` opcional

**Compatibilidade:**

- ✅ Payload antigo continua funcionando 100%
- ✅ Novo payload com `destination`/`callback` funciona

### 4. **`src/index.ts`** (ATUALIZADO)

**Endpoint `/queue/webhooks/add` agora aceita:**

**Formato ANTIGO (compatibilidade):**

```json
{
  "tenantId": 123,
  "integrationId": 456,
  "url": "https://api.com/webhook",
  "method": "POST",
  "headers": {},
  "body": {}
}
```

**Formato NOVO (padronizado):**

```json
{
  "jobType": "webhook",
  "tenantId": 123,
  "integrationId": 456,
  "destination": {
    "url": "https://api.com/webhook",
    "method": "POST",
    "headers": {},
    "body": {}
  },
  "callback": {
    "url": "https://seu-app.com/api/queue/callback"
  },
  "options": {
    "retries": 3,
    "backoff": 2000
  }
}
```

---

## 🔐 Segurança: Bearer Token

### Worker envia callback com:

```http
POST https://seu-app.com/api/queue/callback
Content-Type: application/json
Authorization: Bearer <QUEUE_WORKER_SECRET>

{
  "jobId": "job_123",
  "status": "success",
  ...
}
```

### Next.js valida com:

```typescript
const authHeader = req.headers.authorization;

if (!authHeader || !authHeader.startsWith('Bearer ')) {
  return res.status(401).json({ error: 'Missing Bearer Token' });
}

const token = authHeader.substring(7); // Remove "Bearer "
const secret = process.env.QUEUE_WORKER_SECRET;

if (token !== secret) {
  return res.status(401).json({ error: "Invalid Bearer Token" });
}
```

---

## 🔑 Variável de Ambiente Necessária

```env
# .env (JÁ EXISTE)
QUEUE_WORKER_SECRET="408c02491b2cb008aaf853a46144844abf3ef6c08ddf621c3072314fbffb8a02"
```

**⚠️ IMPORTANTE:**

- ✅ O callback URL **vem no payload** (campo `callback.url`)
- ✅ **NÃO** precisa de `NEXTJS_CALLBACK_URL` ou `APP_URL` para callbacks
- ✅ Cada request pode ter seu próprio callback URL

---

## 📊 Payload do Callback

### Sucesso:

```json
{
  "jobId": "job_123",
  "jobType": "webhook",
  "tenantId": 123,
  "integrationId": 456,
  "negocioId": 789,
  "status": "success",
  "success": true,
  "destination": {
    "url": "https://api.com/webhook",
    "method": "POST",
    "statusCode": 200,
    "headers": { "content-type": "application/json" },
    "body": { "success": true },
    "duration": 1234
  },
  "execution": {
    "attempt": 1,
    "maxAttempts": 5,
    "startedAt": "2025-11-03T10:00:00.000Z",
    "completedAt": "2025-11-03T10:00:01.234Z",
    "duration": 1234
  },
  "metadata": { "userId": 55 }
}
```

### Erro com Retry:

```json
{
  "jobId": "job_123",
  "jobType": "webhook",
  "tenantId": 123,
  "status": "retrying",
  "success": false,
  "destination": {
    "url": "https://api.com/webhook",
    "method": "POST",
    "statusCode": 0,
    "duration": 5000
  },
  "error": {
    "message": "Connection timeout",
    "code": "TIMEOUT",
    "isRetryable": true
  },
  "execution": {
    "attempt": 1,
    "maxAttempts": 5,
    "startedAt": "2025-11-03T10:00:00.000Z",
    "completedAt": "2025-11-03T10:00:05.000Z",
    "duration": 5000,
    "nextRetryAt": "2025-11-03T10:00:09.000Z"
  }
}
```

### Falha Definitiva:

```json
{
  "jobId": "job_123",
  "status": "failed",
  "success": false,
  "error": {
    "message": "HTTP 400: Bad Request",
    "code": "UNKNOWN_ERROR",
    "isRetryable": false
  },
  "execution": {
    "attempt": 5,
    "maxAttempts": 5,
    ...
  }
}
```

---

## 🧪 Como Testar

### 1. **Formato Antigo (compatibilidade):**

```bash
curl -X POST http://localhost:3002/queue/webhooks/add \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": 123,
    "integrationId": 456,
    "url": "https://webhook.site/xyz",
    "method": "POST",
    "body": { "test": true }
  }'
```

### 2. **Formato Novo (com callback):**

```bash
curl -X POST http://localhost:3002/queue/webhooks/add \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "webhook",
    "tenantId": 123,
    "integrationId": 456,
    "destination": {
      "url": "https://webhook.site/xyz",
      "method": "POST",
      "body": { "test": true }
    },
    "callback": {
      "url": "https://seu-app.ngrok.io/api/queue/callback"
    }
  }'
```

### 3. **Verificar Logs:**

```bash
# Ver logs do worker
docker-compose logs -f worker

# Procurar por:
# - "callback_success" (callback enviado)
# - "webhook_success" (job processado)
```

---

## ✅ Checklist de Implementação

- [x] Criar `src/lib/types.ts` com interfaces padronizadas
- [x] Criar `src/lib/callbackSender.ts` com Bearer Token e retry
- [x] Atualizar `webhookWorker.ts` para enviar callbacks
- [x] Atualizar endpoint `/queue/webhooks/add` para aceitar ambos formatos
- [x] Validar variável `QUEUE_WORKER_SECRET` (já existe)
- [x] Garantir compatibilidade retroativa (formato antigo funciona)
- [x] Tornar `integrationId` opcional (para emails, SMS)
- [x] Adicionar logging estruturado JSON

---

## 🚀 Resultado Final

**Sistema 100% event-driven e escalável!**

1. ✅ Next.js enfileira job com callback URL
2. ✅ Worker processa job (webhook, email, etc)
3. ✅ Worker envia callback com Bearer Token para Next.js
4. ✅ Next.js valida Bearer Token e salva log no banco
5. ✅ Retry automático em ambos os lados

**Pronto para produção!** 🎉
