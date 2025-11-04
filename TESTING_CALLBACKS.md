# 🚀 Como Testar o Sistema de Callbacks

## 📋 Pré-requisitos

1. Worker rodando: `docker-compose up --build`
2. Next.js (ou mock server) para receber callbacks

---

## 🧪 Opção 1: Teste Rápido com Mock Server

### 1️⃣ Inicie o Mock Server (Terminal 1)

```bash
npm run mock:callback
```

Saída esperada:

```
🚀 Mock Callback Server rodando em http://localhost:3003
📍 Endpoint: POST http://localhost:3003/api/queue/callback
✅ Pronto para receber callbacks do worker!
```

### 2️⃣ Exponha com ngrok (Terminal 2)

```bash
ngrok http 3003
```

Copie a URL: `https://xyz123.ngrok.io`

### 3️⃣ Envie Job com Callback (Terminal 3)

```bash
curl -X POST http://localhost:3002/queue/webhooks/add \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "webhook",
    "tenantId": 123,
    "integrationId": 456,
    "destination": {
      "url": "https://webhook.site/unique-id",
      "method": "POST",
      "body": { "test": true }
    },
    "callback": {
      "url": "https://xyz123.ngrok.io/api/queue/callback"
    }
  }'
```

### 4️⃣ Veja os Resultados

**No Terminal 1 (Mock Server):**

```
🎯 Callback Recebido:
====================
Job ID: job_1699012345_abc123
Status: success (✅)
Tenant: 123
Webhook URL: https://webhook.site/unique-id
Status HTTP: 200
Duração: 1234ms
Tentativa: 1/5
✅ Signature válida!
💾 Salvando no banco de dados...
✅ Callback processado com sucesso!
```

**No Docker (Worker):**

```bash
docker-compose logs -f worker | grep callback

# Saída:
# {"level":"info","event":"sending_callback","job_id":"..."}
# {"level":"info","event":"callback_success","http_status":200}
```

---

## 🧪 Opção 2: Teste com Next.js Real

### 1️⃣ No Next.js, crie o endpoint:

```typescript
// app/api/queue/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-webhook-signature");
  const payload = await req.json();

  // Validar HMAC
  const secret = process.env.QUEUE_WORKER_SECRET!;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");

  if (signature !== expectedSignature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Salvar log no banco
  await db.integrationWebhookLog.create({
    data: {
      integrationId: payload.integrationId,
      tenantId: payload.tenantId,
      negocioId: payload.negocioId,
      url: payload.destination.url,
      method: payload.destination.method,
      statusCode: payload.destination.statusCode,
      success: payload.success,
      errorMessage: payload.error?.message,
      requestBody: JSON.stringify(payload.destination.body),
      responseBody: JSON.stringify(payload.destination.body),
      duration: payload.destination.duration,
      attemptNumber: payload.execution.attempt,
    },
  });

  return NextResponse.json({ success: true });
}
```

### 2️⃣ Configure o `.env` do Next.js:

```env
QUEUE_WORKER_SECRET="408c02491b2cb008aaf853a46144844abf3ef6c08ddf621c3072314fbffb8a02"
```

### 3️⃣ No Next.js, ao enfileirar webhook:

```typescript
// Antes (formato antigo):
await fetch("http://worker:3002/queue/webhooks/add", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tenantId: 123,
    integrationId: 456,
    url: "https://api.com/webhook",
    method: "POST",
    headers: {},
    body: {},
  }),
});

// Agora (formato novo com callback):
await fetch("http://worker:3002/queue/webhooks/add", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jobType: "webhook",
    tenantId: 123,
    integrationId: 456,
    destination: {
      url: "https://api.com/webhook",
      method: "POST",
      body: {},
    },
    callback: {
      url: `${process.env.NEXT_PUBLIC_APP_URL}/api/queue/callback`,
    },
  }),
});
```

---

## 🧪 Opção 3: Teste com webhook.site

### 1️⃣ Abra https://webhook.site e copie seu UUID

### 2️⃣ Configure as variáveis:

```bash
export WEBHOOK_SITE="https://webhook.site/SEU-UUID-AQUI"
export CALLBACK_URL="https://webhook.site/SEU-UUID-AQUI"
```

### 3️⃣ Execute o script de teste:

```bash
npm run test:callback
```

### 4️⃣ Veja os resultados:

1. Abra `https://webhook.site/SEU-UUID-AQUI`
2. Verá 3 requests:
   - **1º:** Webhook original (destination)
   - **2º:** Callback de sucesso (com HMAC)
   - **3º:** Webhook formato antigo
   - **4º:** Callback de sucesso do antigo

---

## 📊 Verificar Status dos Jobs

```bash
# Estatísticas da fila
curl http://localhost:3002/queue/webhooks/stats | jq

# Métricas gerais
npm run metrics

# Logs em tempo real
docker-compose logs -f worker

# Filtrar callbacks
docker-compose logs -f worker | grep callback
```

---

## 🔍 Troubleshooting

### Callback não está sendo enviado?

1. **Verifique se o payload tem `callback.url`:**

   ```bash
   docker-compose logs worker | grep "callback_url"
   ```

2. **Verifique se `QUEUE_WORKER_SECRET` está definido:**

   ```bash
   docker-compose exec worker env | grep QUEUE_WORKER_SECRET
   ```

3. **Veja erros de callback:**
   ```bash
   docker-compose logs worker | grep "callback_send_failed"
   ```

### Signature inválida?

1. **Verifique se o secret é o mesmo:**

   - Worker: `QUEUE_WORKER_SECRET` no `.env`
   - Next.js: `QUEUE_WORKER_SECRET` no `.env`

2. **Teste a validação:**

   ```javascript
   const payload = { test: true };
   const secret = "seu-secret-aqui";

   const signature = crypto
     .createHmac("sha256", secret)
     .update(JSON.stringify(payload))
     .digest("hex");

   console.log(signature);
   ```

### Worker não está processando?

```bash
# Verificar se o worker está ativo
curl http://localhost:3002/queue/health | jq

# Ver jobs na fila
npm run queue:stats

# Limpar fila (cuidado!)
npm run queue:clean
```

---

## ✅ Checklist de Teste

- [ ] Mock server rodando
- [ ] ngrok expondo mock server
- [ ] Job enfileirado com sucesso (200)
- [ ] Worker processou job (logs mostram "webhook_success")
- [ ] Callback foi enviado (logs mostram "callback_success")
- [ ] Mock server recebeu callback
- [ ] Signature foi validada
- [ ] Teste com falha (URL inválida)
- [ ] Callback de retry foi enviado
- [ ] Teste formato antigo (compatibilidade)

---

## 🎉 Tudo Funcionando?

Parabéns! O sistema de callbacks está pronto para produção! 🚀

**Próximos passos:**

1. Deploy do worker com callback habilitado
2. Atualizar Next.js para usar novo formato
3. Monitorar callbacks no dashboard
4. Adicionar alertas para callbacks falhando

---

## 📚 Documentação Adicional

- [CALLBACKS.md](./CALLBACKS.md) - Documentação completa do sistema
- [API.md](./API.md) - Referência da API
- [ENDPOINTS.md](./ENDPOINTS.md) - Lista de endpoints
