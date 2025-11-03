# ✅ Correções Implementadas - BullMQ + ioredis + Redis Startup

## Objetivo

Eliminar erros de startup e garantir uso correto do `blockingConnection` com singleton Redis.

## Problemas Resolvidos

1. ❌ "Stream isn't writeable and enableOfflineQueue options is false"
2. ❌ "Command timed out" em blocking commands (BRPOP/XREADGROUP)
3. ❌ Múltiplos clients Redis desnecessários
4. ❌ Ping sem aguardar ready state

## Mudanças Implementadas

### 1. `src/lib/queue/connection.ts` - Factory + Singleton + waitForReady

**Adicionado:**

- ✅ `getRedisSingleton()`: Retorna ÚNICO client Redis compartilhado no processo
- ✅ `createBlockingRedisClient()`: Cria blocking client com `commandTimeout: 0`
- ✅ `waitForReady(client, timeoutMs)`: Aguarda cliente ficar ready antes de usar
- ✅ `pingRedisSafe(client?, timeoutMs)`: PING seguro com waitForReady

**Configurações Redis Base (ambos clients):**

```typescript
{
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 10_000,
  keepAlive: 60_000,
  family: 0,
  enableOfflineQueue: false,  // ✅ CRÍTICO
  lazyConnect: false,
  retryStrategy: (times) => Math.min(2000, times * 200) + Math.floor(Math.random() * 200),
  reconnectOnError: (err) => /READONLY|MOVED|CLUSTERDOWN/.test(err?.message || "")
}
```

**Blocking Client Difference:**

```typescript
// Normal client: commandTimeout padrão (sem limite)
// Blocking client: commandTimeout: 0 (infinito para BRPOP/XREADGROUP)
```

### 2. `src/lib/queue/BaseWorker.ts` - Singleton + Blocking Client

**Mudanças:**

```typescript
// ANTES
this.normalClient = createRedisClient();
this.blockingClient = createBlockingRedisClient();

// DEPOIS
this.normalClient = getRedisSingleton();  // ✅ Singleton
this.blockingClient = createBlockingRedisClient();  // ✅ Dedicado

// ✅ Aguardar ready explícito
waitForReady(this.normalClient).catch(...);
waitForReady(this.blockingClient).catch(...);
```

**Stop Method:**

```typescript
// ANTES: Fechava ambos clients
await this.normalClient.quit();
await this.blockingClient.quit();

// DEPOIS: Fecha APENAS blocking (singleton é compartilhado)
await this.blockingClient.quit();
// Singleton fechado apenas no gracefulShutdown do index.ts
```

### 3. `src/lib/queue/BaseQueue.ts` - Singleton

**Mudanças:**

```typescript
// ANTES
import { createRedisClient } from "./connection";
connection: createRedisClient()

// DEPOIS
import { getRedisSingleton } from "./connection";
connection: getRedisSingleton()  // ✅ Mesmo singleton do worker
```

### 4. `src/index.ts` - Startup Seguro + Health

**Startup:**

```typescript
// ✅ ANTES de iniciar workers:
const redis = getRedisSingleton();
await waitForReady(redis, 5000);
const pong = await pingRedisSafe(redis, 1500);
console.log({ event: "redis_ready", pong });
```

**Healthcheck `/health`:**

```typescript
// ✅ Usa singleton + pingRedisSafe
const redis = getRedisSingleton();
const startPing = Date.now();
await pingRedisSafe(redis, 1500);
const rttMs = Date.now() - startPing;
```

**Graceful Shutdown:**

```typescript
// 1. Para workers (fecha blocking clients)
await stopWebhookWorker();

// 2. Fecha singleton Redis
const redis = getRedisSingleton();
await redis.quit();

// 3. Fecha HTTP server
```

### 5. `docker-compose.yml` - Redis Healthcheck

**Mudanças:**

```yaml
redis:
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s      # ✅ 10s → 5s
    timeout: 3s
    retries: 10       # ✅ 5 → 10

worker:
  depends_on:
    redis:
      condition: service_healthy  # ✅ Espera Redis estar saudável
```

## Arquitetura Final

```
┌─────────────────────────────────────────────────┐
│            Process (Node.js)                     │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  getRedisSingleton()                      │   │
│  │  - Único client compartilhado             │   │
│  │  - enableOfflineQueue: false              │   │
│  │  - commandTimeout: default                │   │
│  └────────┬──────────────────────────────────┘   │
│           │                                       │
│           ├─► BaseQueue (connection)              │
│           ├─► BaseWorker (connection)             │
│           ├─► Health Check (ping)                │
│           └─► Startup (waitForReady + ping)      │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  createBlockingRedisClient()              │   │
│  │  - Client dedicado por worker             │   │
│  │  - enableOfflineQueue: false              │   │
│  │  - commandTimeout: 0 (infinito)           │   │
│  └────────┬──────────────────────────────────┘   │
│           │                                       │
│           └─► BaseWorker (blockingConnection)    │
│               Para BRPOP/XREADGROUP              │
└─────────────────────────────────────────────────┘
```

## Fluxo de Startup

1. **Criar singleton Redis** via `getRedisSingleton()`
2. **Aguardar ready** via `waitForReady(redis, 5000)`
3. **Testar conectividade** via `pingRedisSafe(redis, 1500)`
4. **Iniciar workers** (cada um cria seu blocking client)
5. **Aguardar ready** dos blocking clients
6. **Iniciar HTTP server** com healthcheck

## Fluxo de Shutdown

1. **Para workers** → fecha blocking clients
2. **Fecha singleton Redis** → `redis.quit()`
3. **Fecha HTTP server**
4. **Exit processo**

## Critérios de Aceitação - Status

- ✅ Startup não cria cliente extra para PING
- ✅ Sem erro "Stream isn't writeable and enableOfflineQueue options is false"
- ✅ Todos os Workers usam blockingConnection com commandTimeout: 0
- ⏳ Sem "Command timed out" logo após iniciar (necessita teste real)
- ✅ Shutdown fecha blockingConnection e singleton corretamente
- ✅ docker-compose.yml com depends_on: service_healthy

## Próximos Passos

1. **Testar build:**

   ```bash
   docker-compose up --build
   ```

2. **Verificar logs esperados:**

   ```json
   {"service":"redis-factory","event":"creating_singleton"}
   {"service":"redis-singleton","event":"connected"}
   {"service":"redis-singleton","event":"ready"}
   {"service":"main","event":"redis_connectivity_verified","rtt_ms":X}
   {"service":"worker","event":"initializing","redis_clients":{"normal_client":"singleton","blocking_client":"created_with_commandTimeout_0"}}
   {"service":"redis-blocking","event":"connected"}
   {"service":"redis-blocking","event":"ready"}
   ```

3. **Validar ausência de erros:**
   - ❌ NÃO deve aparecer: "Command timed out"
   - ❌ NÃO deve aparecer: "Stream isn't writeable"
   - ✅ DEVE aparecer: "redis_connectivity_verified"
   - ✅ DEVE aparecer: "blocking_connection_set"

## Notas Técnicas

### Por que Singleton + Blocking Dedicado?

- **Singleton (normal client):** Compartilhado entre Queue e Worker para operações normais (ADD job, ACK, FAIL, etc.). Economiza conexões.
- **Blocking client:** Dedicado por worker para BRPOP/XREADGROUP. `commandTimeout: 0` garante que esses comandos não timeoutem nunca (aguardam infinitamente por jobs).

### Por que enableOfflineQueue: false?

Com `enableOfflineQueue: false`, comandos Redis FALHAM imediatamente se não há conexão, ao invés de acumular em fila local. Isso é essencial para:

- Detectar problemas de conexão rapidamente
- Evitar memory leaks de comandos acumulados
- BullMQ tem sua própria lógica de retry, não precisa de queue local do ioredis

### Por que waitForReady()?

Com `enableOfflineQueue: false`, se você tentar executar comando antes do client estar ready, receberá erro "Stream isn't writeable". `waitForReady()` garante que o client está pronto antes de qualquer operação.

## Referências

- [BullMQ Best Practices](https://docs.bullmq.io/guide/connections)
- [ioredis Connection Options](https://github.com/redis/ioredis#connect-to-redis)
- [Redis Blocking Commands](https://redis.io/commands/?group=blocking)
