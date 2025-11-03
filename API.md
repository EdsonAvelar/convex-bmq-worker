# API do Worker BullMQ - Guia de Uso

## Endpoints Disponíveis

### 1. Health Check
```bash
# Verificar se o worker está saudável
curl http://localhost:3002/health

# Resposta:
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
  "timestamp": "2025-11-03T20:30:00.000Z"
}
```

### 2. Adicionar Job de Webhook (POST)
```bash
# Adicionar um job na fila
curl -X POST http://localhost:3002/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": 1,
    "webhookUrl": "https://webhook.site/unique-id",
    "payload": {
      "event": "user.created",
      "data": {
        "id": 123,
        "email": "user@example.com"
      }
    },
    "headers": {
      "X-Custom-Header": "value"
    }
  }'

# Resposta:
{
  "success": true,
  "jobId": "123",
  "message": "Webhook job added to queue"
}
```

### 3. Estatísticas da Fila (GET)
```bash
# Ver status da fila
curl http://localhost:3002/webhooks/stats

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
  "timestamp": "2025-11-03T20:30:00.000Z"
}
```

## Testando o Worker

### 1. Inicie o Docker Compose
```bash
docker-compose up --build
```

### 2. Verifique o Health
```bash
curl http://localhost:3002/health
```

### 3. Adicione um Job de Teste
```bash
curl -X POST http://localhost:3002/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": 1,
    "webhookUrl": "https://webhook.site/your-unique-id",
    "payload": {
      "event": "test.event",
      "message": "Hello from BullMQ!"
    }
  }'
```

### 4. Monitore os Logs
```bash
# Logs do worker em tempo real
docker-compose logs -f worker

# Você verá algo como:
# {"level":"info","service":"worker","event":"job_processing","job_id":"123"}
# {"level":"info","service":"webhook","event":"request_sent","status":200,"duration_ms":150}
# {"level":"info","service":"worker","event":"job_success","job_id":"123"}
```

### 5. Verifique as Estatísticas
```bash
curl http://localhost:3002/webhooks/stats
```

## Exemplo de Integração Next.js

### API Route (app/api/webhooks/route.ts)
```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Enviar para o worker BullMQ
    const response = await fetch('http://worker:3002/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenantId: body.tenantId,
        webhookUrl: body.webhookUrl,
        payload: body.payload,
        headers: body.headers || {},
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || 'Failed to queue webhook' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error queuing webhook:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### Client Component (components/WebhookTester.tsx)
```typescript
'use client';

import { useState } from 'react';

export default function WebhookTester() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const sendWebhook = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: 1,
          webhookUrl: 'https://webhook.site/your-unique-id',
          payload: {
            event: 'test.event',
            timestamp: new Date().toISOString(),
          },
        }),
      });
      
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ error: String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <button
        onClick={sendWebhook}
        disabled={loading}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        {loading ? 'Enviando...' : 'Testar Webhook'}
      </button>
      
      {result && (
        <pre className="mt-4 p-4 bg-gray-100 rounded">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

## Docker Compose para Next.js + Worker

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  worker:
    build: ./worker
    depends_on:
      redis:
        condition: service_healthy
    environment:
      REDIS_URL: redis://redis:6379
    ports:
      - "3002:3002"

  nextjs:
    build: ./nextjs-app
    depends_on:
      - worker
      - redis
    environment:
      WORKER_URL: http://worker:3002
    ports:
      - "3000:3000"
```

## Endpoints para Monitoramento

### Redis Status
```bash
curl http://localhost:3002/redis
```

### Readiness (K8s/Railway)
```bash
curl http://localhost:3002/ready
```

### Liveness (K8s/Railway)
```bash
curl http://localhost:3002/live
```

## Teste de Carga

```bash
# Adicionar 100 jobs rapidamente
for i in {1..100}; do
  curl -X POST http://localhost:3002/webhooks \
    -H "Content-Type: application/json" \
    -d "{
      \"tenantId\": $((RANDOM % 10 + 1)),
      \"webhookUrl\": \"https://webhook.site/test-$i\",
      \"payload\": {
        \"event\": \"test.load\",
        \"index\": $i
      }
    }" &
done
wait

# Verificar estatísticas
curl http://localhost:3002/webhooks/stats
```

## Webhook.site para Testes

1. Acesse https://webhook.site
2. Copie sua URL única
3. Use nos testes:

```bash
curl -X POST http://localhost:3002/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": 1,
    "webhookUrl": "https://webhook.site/SUA-URL-AQUI",
    "payload": {
      "message": "Teste de webhook"
    }
  }'
```

4. Veja a requisição chegar em tempo real no Webhook.site!

## Troubleshooting

### Worker não processa jobs
```bash
# Verificar logs
docker-compose logs -f worker

# Verificar se Redis está ok
curl http://localhost:3002/redis

# Verificar health
curl http://localhost:3002/health
```

### Jobs ficam em "waiting"
- Verifique se o worker está rodando: `docker-compose ps`
- Verifique logs de erro: `docker-compose logs worker | grep error`
- Verifique conexão Redis: `curl http://localhost:3002/redis`

### Jobs falhando
```bash
# Ver estatísticas
curl http://localhost:3002/webhooks/stats

# Ver logs de falha
docker-compose logs worker | grep failed
```
