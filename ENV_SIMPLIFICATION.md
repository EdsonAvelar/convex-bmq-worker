# 🔧 Simplificação de Variáveis de Ambiente

## ✅ Mudanças Realizadas

### **Problema Identificado:**

- ❌ Duas variáveis de secret desnecessárias (`INTERNAL_API_SECRET` + `QUEUE_WORKER_SECRET`)
- ❌ `APP_URL` obrigatória mesmo não sendo usada para callbacks

### **Solução Implementada:**

#### 1. **Unificação de Secrets** ✅

- ❌ ~~`INTERNAL_API_SECRET`~~ (removido)
- ✅ **`QUEUE_WORKER_SECRET`** (único secret necessário)

**Usos do `QUEUE_WORKER_SECRET`:**

- HMAC para assinar callbacks enviados ao Next.js
- Autenticação para API interna de webhook logs (legacy)

#### 2. **`APP_URL` agora é OPCIONAL** ✅

**Antes (ERRO):**

```
Missing required environment variable: APP_URL ou NEXT_PUBLIC_APP_URL
```

**Agora:**

- ✅ Worker inicia normalmente SEM `APP_URL`
- ✅ Callbacks funcionam 100% (URL vem no payload)
- ⚠️ Se `APP_URL` não estiver configurada, apenas não salva logs antigos via API interna

---

## 📦 Variáveis de Ambiente - Resumo Final

### **Obrigatórias:**

```env
# Redis (escolha uma):
REDIS_URL=rediss://...
# OU
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# Secret único:
QUEUE_WORKER_SECRET=your_32_char_secret_here
```

### **Opcionais:**

```env
# Apenas para salvar logs antigos via API interna:
APP_URL=https://your-app.vercel.app

# Configurações do worker:
NODE_ENV=production
PORT=3002
WORKER_CONCURRENCY=5
```

---

## 🔄 Migração

### **Se você já tem `INTERNAL_API_SECRET`:**

1. **No Worker (.env):**

   ```diff
   - INTERNAL_API_SECRET=abc123...
   + QUEUE_WORKER_SECRET=abc123...
   ```

2. **No Next.js (Vercel Environment Variables):**

   ```diff
   - INTERNAL_API_SECRET=abc123...
   + QUEUE_WORKER_SECRET=abc123...
   ```

3. **No código do Next.js:**
   ```diff
   // app/api/internal/webhook-logs/route.ts
   - const secret = req.headers.get("x-internal-secret");
   - if (secret !== process.env.INTERNAL_API_SECRET) {
   + const secret = req.headers.get("x-webhook-signature");
   + const expectedSignature = crypto
   +   .createHmac("sha256", process.env.QUEUE_WORKER_SECRET!)
   +   .update(JSON.stringify(req.body))
   +   .digest("hex");
   + if (secret !== expectedSignature) {
       return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
     }
   ```

### **`APP_URL` não é mais obrigatória:**

Se você **não usar** a funcionalidade de salvar logs antigos via API interna:

- ✅ Pode remover `APP_URL` do `.env`
- ✅ Worker funciona normalmente
- ✅ Callbacks funcionam 100%

Se você **quiser continuar** salvando logs antigos:

- ✅ Mantenha `APP_URL` configurada
- ✅ Worker chamará `/api/internal/webhook-logs` automaticamente

---

## ✅ Benefícios

1. **Simplicidade:** Apenas 1 secret em vez de 2
2. **Flexibilidade:** `APP_URL` opcional
3. **Menos Erros:** Worker inicia mesmo sem `APP_URL`
4. **Consistência:** Mesmo secret para callbacks e autenticação

---

## 🧪 Testar

```bash
# 1. Atualizar .env
REDIS_URL=rediss://...
QUEUE_WORKER_SECRET=your_secret_here
# APP_URL=  # ← Remover ou comentar

# 2. Iniciar worker
docker-compose up --build

# 3. Verificar logs
# ✅ Deve iniciar sem erros
# ⚠️ Se não tiver APP_URL, verá: "app_url_not_configured - skipping legacy webhook log save"

# 4. Enviar job de teste
curl -X POST http://localhost:3002/queue/webhooks/add \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "webhook",
    "tenantId": 123,
    "destination": {
      "url": "https://webhook.site/xyz",
      "method": "POST"
    },
    "callback": {
      "url": "https://your-app.com/api/queue/callback"
    }
  }'

# ✅ Worker processa normalmente
# ✅ Callback é enviado com HMAC
```

---

## 📝 Atualizado em:

- ✅ `src/lib/queue/webhookWorker.ts`
- ✅ `src/index.ts`
- ✅ `.env`
- ✅ `.env.example`
- ✅ `README.md`

**Status:** ✅ **Implementado e Testado**
