# 🔄 Migração de Estrutura de Payload - Webhook Worker

## ⚠️ BREAKING CHANGE

A estrutura do payload foi atualizada para melhor consistência e tipagem.

---

## ❌ Estrutura ANTIGA (Não funciona mais)

```json
{
  "tenantId": 1,
  "webhookUrl": "https://example.com",
  "payload": {
    "event": "test.event",
    "message": "Hello"
  },
  "headers": {
    "X-Custom": "value"
  }
}
```

**Problemas:**

- Campo `webhookUrl` (inconsistente)
- Campo `payload` (genérico demais)
- Falta `integrationId` (necessário para logs)
- Falta `method` (sempre assumia POST)

---

## ✅ Estrutura NOVA (Atual)

```json
{
  "tenantId": 1,
  "integrationId": 5,
  "integrationName": "Nome da Integração",
  "negocioId": 12345,
  "url": "https://example.com",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json",
    "X-Custom": "value"
  },
  "body": {
    "event": "test.event",
    "message": "Hello"
  }
}
```

**Campos obrigatórios:**

- ✅ `tenantId` (number) - ID do tenant
- ✅ `integrationId` (number) - ID da integração (para logs)
- ✅ `url` (string) - URL de destino do webhook
- ✅ `method` (string) - Método HTTP (POST, PUT, PATCH, etc)

**Campos opcionais:**

- `integrationName` (string) - Nome da integração (default: "Webhook")
- `negocioId` (number) - ID do negócio relacionado
- `headers` (object) - Headers customizados
- `body` (any) - Payload a ser enviado (pode ser objeto, array, etc)

---

## 🔧 Como Migrar seu Código

### Antes (estrutura antiga):

```typescript
await fetch('http://worker:3002/webhooks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tenantId: 1,
    webhookUrl: 'https://example.com/webhook',
    payload: {
      event: 'user.created',
      data: { userId: 123 }
    }
  })
});
```

### Depois (estrutura nova):

```typescript
await fetch('http://worker:3002/queue/webhooks/add', {  // ← Novo endpoint!
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tenantId: 1,
    integrationId: 5,                    // ← NOVO (obrigatório)
    integrationName: 'User Webhook',     // ← NOVO (opcional)
    url: 'https://example.com/webhook',  // ← Renomeado de webhookUrl
    method: 'POST',                       // ← NOVO (obrigatório)
    headers: {                            // ← Mesmo
      'Content-Type': 'application/json'
    },
    body: {                               // ← Renomeado de payload
      event: 'user.created',
      data: { userId: 123 }
    }
  })
});
```

---

## 📋 Checklist de Migração

- [ ] Trocar `webhookUrl` → `url`
- [ ] Trocar `payload` → `body`
- [ ] Adicionar `integrationId` (obrigatório)
- [ ] Adicionar `method` (obrigatório)
- [ ] Adicionar `integrationName` (opcional, mas recomendado)
- [ ] Atualizar testes
- [ ] Atualizar documentação

---

## 🧪 Testando a Nova Estrutura

### Teste rápido com curl:

```bash
curl -X POST http://localhost:3002/queue/webhooks/add \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": 1,
    "integrationId": 999,
    "integrationName": "Teste",
    "url": "https://webhook.site/your-unique-id",
    "method": "POST",
    "body": {
      "message": "Teste de migração"
    }
  }'
```

### Resposta esperada:

```json
{
  "success": true,
  "jobId": "123",
  "message": "Webhook job added to queue"
}
```

### Erro se usar estrutura antiga:

```json
{
  "error": "Missing required fields: tenantId, integrationId, url, method",
  "received": ["tenantId", "webhookUrl", "payload"],
  "expected": ["tenantId", "integrationId", "url", "method"]
}
```

---

## 📊 Logs Detalhados

Agora **todos os payloads são logados** para facilitar debug:

```json
{
  "timestamp": "2025-11-03T...",
  "level": "info",
  "service": "api",
  "event": "webhook_request_received",
  "payload": { ... },
  "payload_keys": ["tenantId", "integrationId", "url", "method"]
}
```

Se a validação falhar, você verá:

```json
{
  "level": "error",
  "event": "webhook_validation_failed",
  "received_fields": {
    "tenantId": true,
    "integrationId": false,  // ← Faltando!
    "url": false,             // ← Faltando!
    "method": false           // ← Faltando!
  }
}
```

---

## ❓ FAQ

**P: Por que mudar?**
R: Melhor tipagem, consistência com `WebhookJobData`, e suporte a mais métodos HTTP.

**P: A estrutura antiga ainda funciona?**
R: Não. É necessário migrar.

**P: Como migrar gradualmente?**
R: Você pode criar uma rota `/webhooks/legacy` temporária se precisar de compatibilidade reversa.

**P: O `body` pode ser array?**
R: Sim! Pode ser objeto, array, string, número, etc.

---

## 📚 Exemplos Prontos

Veja em `/examples/`:

- `test-simple.json` - Exemplo básico
- `webhook-venda-fechada.json` - Exemplo completo
- `test-simple.sh` - Script de teste rápido
