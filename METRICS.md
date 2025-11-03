# 📊 Métricas e Monitoramento - BullMQ Worker

## Endpoint de Métricas

### GET /metrics

Retorna métricas detalhadas de performance, saúde do sistema e recomendações automáticas.

```bash
curl http://localhost:3002/metrics
```

## Exemplo de Resposta

```json
{
  "timestamp": "2025-11-03T20:30:00.000Z",
  "uptime": 3600,

  "jobs": {
    "processed": 1500,
    "failed": 3,
    "totalDurationMs": 225000,
    "avgDurationMs": 150,
    "minDurationMs": 85,
    "maxDurationMs": 2500,
    "lastProcessedAt": "2025-11-03T20:29:58.000Z",
    "successRate": "99.80%"
  },

  "performance": {
    "jobsPerSecond": 25,
    "jobsLastMinute": 1200,
    "jobsLastHour": 45000,
    "currentThroughput": "25 jobs/second",
    "estimatedCapacity": "1500 jobs/minute"
  },

  "queue": {
    "waiting": 5,
    "active": 8,
    "completed": 1500,
    "failed": 3,
    "status": "✅ Healthy"
  },

  "health": {
    "bottlenecks": ["NONE"],
    "recommendations": ["System running optimally"],
    "needsScaling": false
  },

  "errors": {
    "count": 3,
    "lastError": "Webhook timeout after 12000ms",
    "lastErrorAt": "2025-11-03T19:45:00.000Z"
  }
}
```

## 🚨 Interpretando as Métricas

### 1. Jobs Performance

| Métrica                      | O que significa     | Ação necessária                 |
| ---------------------------- | ------------------- | ------------------------------- |
| **avgDurationMs < 500ms**    | ✅ Webhooks rápidos | Nenhuma                         |
| **avgDurationMs 500-2000ms** | ⚠️ Webhooks médios  | Monitorar                       |
| **avgDurationMs > 2000ms**   | 🔴 Webhooks lentos  | Investigar endpoints de destino |
| **successRate > 95%**        | ✅ Saudável         | Nenhuma                         |
| **successRate < 95%**        | 🔴 Problemas        | Verificar erros                 |

### 2. Performance (Throughput)

| Throughput       | Significado             | Ação                                  |
| ---------------- | ----------------------- | ------------------------------------- |
| **> 50 jobs/s**  | ✅ Alta performance     | Nenhuma                               |
| **10-50 jobs/s** | ⚠️ Performance moderada | Considerar escalar se waiting crescer |
| **< 10 jobs/s**  | 🔴 Performance baixa    | Aumentar concurrency ou escalar       |

### 3. Queue Status

| Condição                 | Diagnóstico             | Solução                                     |
| ------------------------ | ----------------------- | ------------------------------------------- |
| **waiting < 10**         | ✅ Processamento em dia | Nenhuma                                     |
| **waiting 10-50**        | ⚠️ Acumulando           | Monitorar                                   |
| **waiting 50-100**       | 🔴 Backlog moderado     | Aumentar WORKER_CONCURRENCY                 |
| **waiting > 100**        | 🔴🔴 Backlog crítico    | Adicionar mais workers (horizontal scaling) |
| **active = concurrency** | ⚠️ No limite            | Aumentar concurrency                        |

### 4. Bottlenecks Automáticos

O sistema identifica gargalos automaticamente:

#### HIGH_QUEUE_BACKLOG

```json
{
  "bottlenecks": ["HIGH_QUEUE_BACKLOG"],
  "recommendations": ["Add more worker instances (horizontal scaling)"]
}
```

**Ação:** Adicione mais workers no docker-compose ou k8s

#### MAX_CONCURRENCY_REACHED

```json
{
  "bottlenecks": ["MAX_CONCURRENCY_REACHED"],
  "recommendations": ["Increase WORKER_CONCURRENCY to process more jobs simultaneously"]
}
```

**Ação:** Aumente `WORKER_CONCURRENCY=50` no `.env`

#### SLOW_WEBHOOK_RESPONSES

```json
{
  "bottlenecks": ["SLOW_WEBHOOK_RESPONSES"],
  "recommendations": ["Check webhook endpoint performance or add timeout"]
}
```

**Ação:** Investigue por que webhooks estão demorando (avg > 2s)

#### LOW_THROUGHPUT

```json
{
  "bottlenecks": ["LOW_THROUGHPUT"],
  "recommendations": ["System running optimally"]
}
```

**Ação:** Sistema está processando < 1 job/s mas tem jobs na fila - possível problema de conexão

## 📈 Monitoramento Contínuo

### Opção 1: Watch Manual

```bash
# Atualiza a cada 2 segundos
watch -n 2 'curl -s http://localhost:3002/metrics | jq'
```

### Opção 2: Script de Monitoramento

Crie `scripts/monitor.sh`:

```bash
#!/bin/bash
while true; do
  clear
  echo "=== BullMQ Worker Metrics ==="
  echo ""

  METRICS=$(curl -s http://localhost:3002/metrics)

  echo "📊 Performance:"
  echo $METRICS | jq -r '"  Jobs/sec: \(.performance.jobsPerSecond)"'
  echo $METRICS | jq -r '"  Avg Duration: \(.jobs.avgDurationMs)ms"'
  echo $METRICS | jq -r '"  Success Rate: \(.jobs.successRate)"'

  echo ""
  echo "📦 Queue:"
  echo $METRICS | jq -r '"  Waiting: \(.queue.waiting)"'
  echo $METRICS | jq -r '"  Active: \(.queue.active)"'
  echo $METRICS | jq -r '"  Status: \(.queue.status)"'

  echo ""
  echo "⚠️  Health:"
  echo $METRICS | jq -r '"  Bottlenecks: \(.health.bottlenecks | join(", "))"'
  echo $METRICS | jq -r '"  Needs Scaling: \(.health.needsScaling)"'

  sleep 2
done
```

Uso:

```bash
chmod +x scripts/monitor.sh
./scripts/monitor.sh
```

### Opção 3: Integração com Grafana/Prometheus

Para ambientes de produção, exponha as métricas no formato Prometheus:

```typescript
// Adicionar ao index.ts
if (path === "/metrics/prometheus" && req.method === "GET") {
  calculatePerformanceMetrics();

  const promMetrics = `
# HELP bullmq_jobs_processed_total Total number of jobs processed
# TYPE bullmq_jobs_processed_total counter
bullmq_jobs_processed_total ${metrics.jobs.processed}

# HELP bullmq_jobs_failed_total Total number of jobs failed
# TYPE bullmq_jobs_failed_total counter
bullmq_jobs_failed_total ${metrics.jobs.failed}

# HELP bullmq_job_duration_ms Average job duration in milliseconds
# TYPE bullmq_job_duration_ms gauge
bullmq_job_duration_ms ${metrics.jobs.avgDurationMs}

# HELP bullmq_throughput_jobs_per_second Current throughput
# TYPE bullmq_throughput_jobs_per_second gauge
bullmq_throughput_jobs_per_second ${metrics.performance.jobsPerSecond}
  `.trim();

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(promMetrics);
}
```

## 🎯 Alertas Recomendados

### Alerta 1: Backlog Crescente

```bash
# Se waiting > 100 por mais de 5 minutos
if [ $(curl -s http://localhost:3002/metrics | jq '.queue.waiting') -gt 100 ]; then
  echo "ALERTA: Backlog alto!"
  # Enviar notificação
fi
```

### Alerta 2: Taxa de Erro Alta

```bash
# Se success rate < 95%
SUCCESS_RATE=$(curl -s http://localhost:3002/metrics | jq -r '.jobs.successRate' | cut -d'%' -f1)
if (( $(echo "$SUCCESS_RATE < 95" | bc -l) )); then
  echo "ALERTA: Taxa de erro alta!"
fi
```

### Alerta 3: Throughput Baixo

```bash
# Se jobs/s < 5 e waiting > 0
THROUGHPUT=$(curl -s http://localhost:3002/metrics | jq '.performance.jobsPerSecond')
WAITING=$(curl -s http://localhost:3002/metrics | jq '.queue.waiting')
if [ "$THROUGHPUT" -lt 5 ] && [ "$WAITING" -gt 0 ]; then
  echo "ALERTA: Throughput baixo com jobs na fila!"
fi
```

## 📊 Dashboard Simples (HTML)

Crie `dashboard.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <title>BullMQ Worker Metrics</title>
  <script>
    async function updateMetrics() {
      const response = await fetch('http://localhost:3002/metrics');
      const data = await response.json();

      document.getElementById('jobsPerSec').textContent = data.performance.jobsPerSecond;
      document.getElementById('avgDuration').textContent = data.jobs.avgDurationMs + 'ms';
      document.getElementById('successRate').textContent = data.jobs.successRate;
      document.getElementById('waiting').textContent = data.queue.waiting;
      document.getElementById('active').textContent = data.queue.active;
      document.getElementById('status').textContent = data.queue.status;
    }

    setInterval(updateMetrics, 2000);
    updateMetrics();
  </script>
</head>
<body>
  <h1>BullMQ Worker Metrics</h1>

  <div>
    <h2>Performance</h2>
    <p>Jobs/sec: <strong id="jobsPerSec">-</strong></p>
    <p>Avg Duration: <strong id="avgDuration">-</strong></p>
    <p>Success Rate: <strong id="successRate">-</strong></p>
  </div>

  <div>
    <h2>Queue</h2>
    <p>Waiting: <strong id="waiting">-</strong></p>
    <p>Active: <strong id="active">-</strong></p>
    <p>Status: <strong id="status">-</strong></p>
  </div>
</body>
</html>
```

## 🚀 Decisões de Scaling Baseadas em Métricas

### Cenário 1: Tudo Normal

```json
{
  "performance": { "jobsPerSecond": 30 },
  "queue": { "waiting": 2, "active": 8 },
  "health": { "needsScaling": false }
}
```

**Decisão:** ✅ Nenhuma ação necessária

### Cenário 2: Aumentar Concurrency

```json
{
  "performance": { "jobsPerSecond": 8 },
  "queue": { "waiting": 45, "active": 10 },
  "health": {
    "bottlenecks": ["MAX_CONCURRENCY_REACHED"],
    "needsScaling": true
  }
}
```

**Decisão:** ⚠️ Aumentar `WORKER_CONCURRENCY=30`

### Cenário 3: Scaling Horizontal

```json
{
  "performance": { "jobsPerSecond": 45 },
  "queue": { "waiting": 150, "active": 50 },
  "health": {
    "bottlenecks": ["HIGH_QUEUE_BACKLOG"],
    "needsScaling": true
  }
}
```

**Decisão:** 🔴 Adicionar 2-3 workers adicionais

### Cenário 4: Problema Externo

```json
{
  "jobs": { "avgDurationMs": 3500 },
  "performance": { "jobsPerSecond": 3 },
  "health": {
    "bottlenecks": ["SLOW_WEBHOOK_RESPONSES"]
  }
}
```

**Decisão:** 🔴 Investigar webhooks de destino (não é problema do worker)

## 📱 Integração com Next.js

```typescript
// app/api/worker/metrics/route.ts
export async function GET() {
  const response = await fetch('http://worker:3002/metrics');
  const metrics = await response.json();

  return Response.json(metrics);
}
```

Então no frontend:

```typescript
const { data: metrics } = useSWR('/api/worker/metrics', {
  refreshInterval: 2000 // Atualiza a cada 2s
});
```

## 🎓 Resumo Executivo

### Métricas que Importam

1. **jobsPerSecond** - Principal indicador de performance
2. **queue.waiting** - Principal indicador de capacidade
3. **avgDurationMs** - Indica qualidade dos webhooks de destino
4. **successRate** - Indica confiabilidade

### Quando Escalar

- **waiting > 50** consistentemente → Aumentar concurrency
- **waiting > 100** consistentemente → Adicionar workers
- **active = concurrency** sempre → Aumentar concurrency
- **jobsPerSecond < 10** com waiting > 0 → Investigar

### Ferramenta Rápida de Diagnóstico

```bash
# Comando único para diagnóstico
curl -s http://localhost:3002/metrics | jq '{
  throughput: .performance.jobsPerSecond,
  waiting: .queue.waiting,
  bottlenecks: .health.bottlenecks,
  action: (if .health.needsScaling then "⚠️ SCALE NOW" else "✅ OK" end)
}'
```
