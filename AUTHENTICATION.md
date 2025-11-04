# 🔐 Autenticação do Worker

## ✅ Endpoint `/queue/webhooks/add` PROTEGIDO

**IMPORTANTE:** Todas as requisições **DEVEM** incluir autenticação. Suportamos **2 métodos**:

1. **HMAC SHA-256** ⭐ **RECOMENDADO** (mais seguro)
2. **Bearer Token** (mais simples, menos seguro)

---

## 🔑 Método 1: HMAC SHA-256 (RECOMENDADO) ⭐

### **Por que HMAC é mais seguro?**

✅ **Integridade:** Valida que o payload não foi adulterado  
✅ **Unique per request:** Cada request tem signature diferente  
✅ **Anti-replay:** Signature muda se payload mudar  
✅ **Timing-safe:** Proteção contra timing attacks

### **Como usar:**

```typescript
import crypto from "crypto";

const payload = {
  jobType: "webhook",
  tenantId: 123,
  destination: { url: "...", method: "POST" },
};

const body = JSON.stringify(payload);
const signature = crypto
  .createHmac("sha256", process.env.QUEUE_WORKER_SECRET!)
  .update(body)
  .digest("hex");

await fetch("http://worker:3002/queue/webhooks/add", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Webhook-Signature": signature, // ✅ HMAC
  },
  body,
});
```

---

## 🔑 Método 2: Bearer Token (Simples)

### **Por que Bearer Token é menos seguro?**

⚠️ **Replay attack:** Token é sempre o mesmo  
⚠️ **Sem integridade:** Não valida alteração do payload  
⚠️ **Interceptável:** Se vazar, pode ser reutilizado

### **Quando usar:**

- Testes rápidos no Postman
- Ambiente de desenvolvimento
- Quando HTTPS garante segurança do canal

### **Como usar:**

```typescript
await fetch("http://worker:3002/queue/webhooks/add", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.QUEUE_WORKER_SECRET}`,
  },
  body: JSON.stringify({ tenantId: 123, ... }),
});
```

---

## 📝 Exemplo Completo no Next.js

```typescript
// lib/queue/enqueueWebhook.ts

export async function enqueueWebhook(data: {
  tenantId: number;
  integrationId?: number;
  destination: {
    url: string;
    method: string;
    body: any;
  };
  callback?: {
    url: string;
  };
}) {
  const workerUrl = process.env.QUEUE_WORKER_URL || "http://worker:3002";
  const token = process.env.QUEUE_WORKER_SECRET!;

  // Adicionar callback URL automaticamente
  const payload = {
    ...data,
    jobType: "webhook",
    callback: data.callback || {
      url: `${process.env.NEXT_PUBLIC_APP_URL}/api/queue/callback`,
    },
  };

  const response = await fetch(`${workerUrl}/queue/webhooks/add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`, // ✅ Bearer token simples
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to enqueue: ${error.error}`);
  }

  const result = await response.json();
  return result.jobId;
}
```

### **Uso:**

```typescript
// app/api/webhooks/trigger/route.ts
import { enqueueWebhook } from "@/lib/queue/enqueueWebhook";

export async function POST(req: Request) {
  const { tenantId, integrationId, webhookUrl, data } = await req.json();

  const jobId = await enqueueWebhook({
    tenantId,
    integrationId,
    destination: {
      url: webhookUrl,
      method: "POST",
      body: data,
    },
  });

  return Response.json({ jobId });
}
```

---

## 🧪 Testar no Postman

**Super simples!** 🎉

1. **Method:** `POST`
2. **URL:** `http://localhost:3002/queue/webhooks/add`
3. **Aba "Authorization":**
   - Type: `Bearer Token`
   - Token: `408c02491b2cb008aaf853a46144844abf3ef6c08ddf621c3072314fbffb8a02`
4. **Aba "Body"** → `raw` → `JSON`:
   ```json
   {
     "jobType": "webhook",
     "tenantId": 123,
     "integrationId": 456,
     "destination": {
       "url": "https://webhook.site/unique-id",
       "method": "POST",
       "body": {
         "test": true
       }
     },
     "callback": {
       "url": "https://your-app.com/api/queue/callback"
     }
   }
   ```
5. **Clique em "Send"** ✅

**Sem scripts! Sem complicação!** 🚀

---

## 🧪 Testar com curl

```bash
curl -X POST http://localhost:3002/queue/webhooks/add \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 408c02491b2cb008aaf853a46144844abf3ef6c08ddf621c3072314fbffb8a02" \
  -d '{
    "jobType": "webhook",
    "tenantId": 123,
    "destination": {
      "url": "https://webhook.site/xyz",
      "method": "POST",
      "body": {"test": true}
    }
  }'
```

---

## ✅ Resposta Esperada (Sucesso):

```json
{
  "success": true,
  "jobId": "job_1699012345_abc123",
  "message": "Webhook job added to queue"
}
```

## ❌ Se esquecer o Bearer token:

```json
{
  "error": "Missing or invalid Authorization header. Use: Authorization: Bearer <token>"
}
```

## ❌ Se o token estiver errado:

```json
{
  "error": "Invalid token"
}
```

---

## 🔐 Resumo de Segurança

| Endpoint                     | Direção          | Autenticação          | Segurança                 | Header                                   |
| ---------------------------- | ---------------- | --------------------- | ------------------------- | ---------------------------------------- |
| `/queue/webhooks/add`        | Next.js → Worker | ✅ HMAC **ou** Bearer | ⭐⭐⭐ HMAC / ⭐⭐ Bearer | `X-Webhook-Signature` ou `Authorization` |
| `/api/queue/callback`        | Worker → Next.js | ✅ HMAC SHA-256       | ⭐⭐⭐                    | `X-Webhook-Signature`                    |
| `/api/internal/webhook-logs` | Worker → Next.js | ✅ HMAC SHA-256       | ⭐⭐⭐                    | `X-Webhook-Signature`                    |

### **Recomendações:**

- **Produção:** Use **HMAC** em todos os endpoints
- **Desenvolvimento/Testes:** Bearer Token é aceitável
- **Sempre use HTTPS** em produção

---

## ⚠️ Migração

Se você já tem código enfileirando jobs **sem autenticação**, precisa atualizar:

### **ANTES (inseguro):**

```typescript
await fetch("http://worker:3002/queue/webhooks/add", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tenantId: 123, url: "...", method: "POST" }),
});
```

### **AGORA (seguro):**

```typescript
await fetch("http://worker:3002/queue/webhooks/add", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.QUEUE_WORKER_SECRET}`, // ✅ Adicionar
  },
  body: JSON.stringify({ tenantId: 123, url: "...", method: "POST" }),
});
```

---

## ✅ Benefícios

1. **Simplicidade:** Bearer token padrão HTTP
2. **Postman-friendly:** Sem scripts necessários
3. **Segurança:** Apenas Next.js pode adicionar jobs
4. **Consistência:** Padrão amplamente usado

**Status:** ✅ **Implementado e Testado**

---

## 🧪 Testar Autenticação

### **Exemplo 1: Node.js (autenticado)** ✅

```bash
npm run test:enqueue
```

**Ou:**

```javascript
const crypto = require("crypto");

const payload = { tenantId: 123, url: "https://webhook.site/xyz", method: "POST" };
const body = JSON.stringify(payload);
const secret = "408c02491b2cb008aaf853a46144844abf3ef6c08ddf621c3072314fbffb8a02";
const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

fetch("http://localhost:3002/queue/webhooks/add", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Webhook-Signature": signature,
  },
  body,
});
```

### **Exemplo 2: Bash/curl (autenticado)** ✅

```bash
bash examples/enqueue-curl-authenticated.sh
```

**Ou:**

```bash
PAYLOAD='{"tenantId":123,"url":"https://webhook.site/xyz","method":"POST"}'
SECRET="408c02491b2cb008aaf853a46144844abf3ef6c08ddf621c3072314fbffb8a02"
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -X POST http://localhost:3002/queue/webhooks/add \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIGNATURE" \
  -d "$PAYLOAD"
```

### **Exemplo 3: Sem autenticação (deve falhar - 401)** ❌

```bash
curl -X POST http://localhost:3002/queue/webhooks/add \
  -H "Content-Type: application/json" \
  -d '{"tenantId":123,"url":"https://webhook.site/xyz","method":"POST"}'
```

**Resposta esperada:**

```json
{
  "error": "Missing X-Webhook-Signature header"
}
```

---

## 🔐 Resumo de Segurança

| Endpoint                     | Direção          | Autenticação    | Header                |
| ---------------------------- | ---------------- | --------------- | --------------------- |
| `/queue/webhooks/add`        | Next.js → Worker | ✅ HMAC SHA-256 | `X-Webhook-Signature` |
| `/api/queue/callback`        | Worker → Next.js | ✅ HMAC SHA-256 | `X-Webhook-Signature` |
| `/api/internal/webhook-logs` | Worker → Next.js | ✅ HMAC SHA-256 | `X-Webhook-Signature` |

**Todos os endpoints agora protegidos com HMAC!** 🎉

---

## ⚠️ Migração

Se você já tem código enfileirando jobs **sem autenticação**, precisa atualizar:

### **ANTES (inseguro):**

```typescript
await fetch("http://worker:3002/queue/webhooks/add", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tenantId: 123, url: "...", method: "POST" }),
});
```

### **AGORA (seguro):**

```typescript
import crypto from "crypto";

const payload = { tenantId: 123, url: "...", method: "POST" };
const body = JSON.stringify(payload);
const signature = crypto
  .createHmac("sha256", process.env.QUEUE_WORKER_SECRET!)
  .update(body)
  .digest("hex");

await fetch("http://worker:3002/queue/webhooks/add", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Webhook-Signature": signature, // ✅ Adicionar
  },
  body,
});
```

---

## ✅ Benefícios

1. **Segurança:** Apenas Next.js pode adicionar jobs
2. **Integridade:** HMAC impede adulteração de payload
3. **Consistência:** Mesmo padrão em todos os endpoints
4. **Auditoria:** Logs de tentativas não autorizadas

**Status:** ✅ **Implementado e Testado**
