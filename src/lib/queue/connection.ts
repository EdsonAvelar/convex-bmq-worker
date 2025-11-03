// src/lib/queue/connection.ts
import { Redis } from "@upstash/redis";
import IORedis, { RedisOptions as IORedisOptions } from "ioredis";

// ============================================================================
// Singleton e State Global
// ============================================================================

let singleton: IORedis | null = null;
let redisConnection: IORedis | null = null;
let upstashClient: Redis | null = null;
let latencyMonitorStarted = false;
let latencyMonitorInterval: NodeJS.Timeout | null = null;

// ============================================================================
// Factory para clientes ioredis (resolve "Command timed out")
// ============================================================================

/**
 * ✅ Configurações Redis base otimizadas para BullMQ
 * Garante que tanto client normal quanto blocking usem as MESMAS opções
 */
export function getRedisBaseOptions(): IORedisOptions {
  // Preferir URL TCP direta (mais robusta)
  const tcpUrl = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL;

  if (tcpUrl) {
    try {
      const u = new URL(tcpUrl);
      const isTls = u.protocol === "rediss:";

      console.log(
        `🔧 [Redis Factory] Usando TCP URL: ${u.hostname}:${u.port || 6379}`
      );

      const baseOptions: IORedisOptions = {
        host: u.hostname,
        port: Number(u.port || 6379),
        username: u.username || "default",
        password: decodeURIComponent(u.password || ""),

        // ✅ Configurações recomendadas para BullMQ
        family: 0, // 0 = IPv4 e IPv6
        maxRetriesPerRequest: null, // Importante para comandos bloqueantes
        enableReadyCheck: false,
        connectTimeout: 10000,
        keepAlive: 60000,

        // ✅ TLS seguro
        tls: isTls ? { rejectUnauthorized: true } : undefined,

        // ✅ Backoff exponencial com jitter
        retryStrategy: (times) => {
          const baseDelay = Math.min(2000, times * 200);
          const jitter = Math.floor(Math.random() * 200);
          return baseDelay + jitter;
        },

        // ✅ Reconexão em erros específicos
        reconnectOnError: (err) => {
          const msg = err?.message || "";
          return /READONLY|MOVED|CLUSTERDOWN|ECONNRESET|ETIMEDOUT/.test(msg);
        },

        // ✅ Workers não devem acumular comandos offline
        enableOfflineQueue: false,
        lazyConnect: false,
        autoResubscribe: true,
        autoResendUnfulfilledCommands: false,
      };

      return baseOptions;
    } catch (e) {
      console.warn(
        "⚠️ [Redis Factory] URL TCP inválida, caindo para REST derivado"
      );
    }
  }

  // Fallback: derivar do REST
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !token) {
    throw new Error(
      "Configure UPSTASH_REDIS_URL/REDIS_URL (recomendado) ou UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN"
    );
  }

  const hostname = restUrl.replace("https://", "");
  console.log(`🔧 [Redis Factory] Derivando TCP de REST: ${hostname}:6379`);

  const baseOptions: IORedisOptions = {
    host: hostname,
    port: 6379,
    username: "default",
    password: token,

    // ✅ Configurações recomendadas para BullMQ
    family: 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10000,
    keepAlive: 60000,

    // ✅ TLS seguro
    tls: { rejectUnauthorized: true },

    // ✅ Backoff exponencial com jitter
    retryStrategy: (times) => {
      const baseDelay = Math.min(2000, times * 200);
      const jitter = Math.floor(Math.random() * 200);
      return baseDelay + jitter;
    },

    // ✅ Reconexão em erros específicos
    reconnectOnError: (err) => {
      const msg = err?.message || "";
      return /READONLY|MOVED|CLUSTERDOWN|ECONNRESET|ETIMEDOUT/.test(msg);
    },

    // ✅ Workers não devem acumular comandos offline
    enableOfflineQueue: false,
    lazyConnect: false,
    autoResubscribe: true,
    autoResendUnfulfilledCommands: false,
  };

  return baseOptions;
}

/**
 * ✅ Cria cliente Redis normal para operações gerais
 * Usa commandTimeout padrão (undefined = sem timeout específico)
 */
export function createRedisClient(): IORedis {
  const opts = getRedisBaseOptions();

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      service: "redis-factory",
      event: "creating_normal_client",
      host: opts.host,
      port: opts.port,
      enableOfflineQueue: opts.enableOfflineQueue,
    })
  );

  return new IORedis(opts);
}

/**
 * ✅ Cria cliente Redis bloqueante para comandos BRPOP/XREADGROUP
 * FORÇA commandTimeout: 0 para comandos bloqueantes infinitos
 */
export function createBlockingRedisClient(): IORedis {
  const base = getRedisBaseOptions();

  // ✅ CRÍTICO: commandTimeout: 0 para comandos bloqueantes
  const blockingOptions: IORedisOptions = {
    ...base,
    commandTimeout: 0,
  };

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      service: "redis-factory",
      event: "creating_blocking_client",
      host: blockingOptions.host,
      port: blockingOptions.port,
      commandTimeout: blockingOptions.commandTimeout,
      enableOfflineQueue: blockingOptions.enableOfflineQueue,
    })
  );

  const client = new IORedis(blockingOptions);

  // Event listeners estruturados
  client.on("connect", () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "redis-blocking",
        event: "connected",
      })
    );
  });

  client.on("ready", () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "redis-blocking",
        event: "ready",
      })
    );
  });

  client.on("error", (err: any) => {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "redis-blocking",
        event: "error",
        error: err.message,
      })
    );
  });

  return client;
}

/**
 * ✅ Retorna singleton de conexão Redis (client normal)
 * ÚNICO client compartilhado no processo - evita múltiplas conexões
 */
export function getRedisSingleton(): IORedis {
  if (singleton) {
    return singleton;
  }

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      service: "redis-factory",
      event: "creating_singleton",
    })
  );

  singleton = new IORedis(getRedisBaseOptions());

  // Event listeners estruturados
  singleton.on("connect", () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "redis-singleton",
        event: "connected",
      })
    );
  });

  singleton.on("ready", () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "redis-singleton",
        event: "ready",
      })
    );
  });

  singleton.on("error", (err: any) => {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "redis-singleton",
        event: "error",
        error: err.message,
      })
    );
  });

  singleton.on("reconnecting", (delay: number) => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        service: "redis-singleton",
        event: "reconnecting",
        delay_ms: delay,
      })
    );
  });

  singleton.on("close", () => {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        service: "redis-singleton",
        event: "closed",
      })
    );
  });

  return singleton;
}

/**
 * ✅ Aguarda cliente Redis ficar pronto antes de usar
 * Resolve erro "Stream isn't writeable and enableOfflineQueue options is false"
 */
export async function waitForReady(
  client: IORedis,
  timeoutMs = 5000
): Promise<void> {
  if (client.status === "ready") {
    return;
  }

  // Se está conectando ou reconectando, aguardar
  if (client.status === "connecting" || client.status === "reconnecting") {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onTimeout = () => {
        cleanup();
        reject(new Error(`Redis ready timeout after ${timeoutMs}ms`));
      };

      const timer = setTimeout(onTimeout, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        client.off("ready", onReady);
        client.off("error", onError);
      };

      client.once("ready", onReady);
      client.once("error", onError);
    });
    return;
  }

  // Se não está conectado, tentar conectar
  if (client.status === "end" || client.status === "close") {
    await client.connect();
    await waitForReady(client, timeoutMs); // Recursivo para aguardar ready
    return;
  }

  // Para outros status, aguardar evento ready
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onTimeout = () => {
      cleanup();
      reject(
        new Error(
          `Redis ready timeout after ${timeoutMs}ms (status: ${client.status})`
        )
      );
    };

    const timer = setTimeout(onTimeout, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      client.off("ready", onReady);
      client.off("error", onError);
    };

    client.once("ready", onReady);
    client.once("error", onError);
  });
}

/**
 * ✅ PING seguro - aguarda ready antes de executar
 * Evita erro de offline queue quando enableOfflineQueue: false
 */
export async function pingRedisSafe(
  client?: IORedis,
  timeoutMs = 1500
): Promise<"PONG"> {
  const c = client ?? getRedisSingleton();

  await waitForReady(c, 5000);

  const res = await c.ping();
  return res as "PONG";
}

function startRedisLatencyMonitor(
  ioredis: IORedis,
  rest: Redis,
  hostname: string
) {
  if (latencyMonitorStarted) return;
  latencyMonitorStarted = true;

  console.log(`🧭 [Redis] Conectado ao Upstash: ${hostname}`);

  const probe = async () => {
    try {
      const t1 = Date.now();
      await ioredis.ping();
      const tcpRtt = Date.now() - t1;

      const t2 = Date.now();
      await rest.ping();
      const restRtt = Date.now() - t2;

      console.log(
        `📶 [Redis RTT] TCP=${tcpRtt}ms | REST=${restRtt}ms (host=${hostname})`
      );
    } catch (err: any) {
      console.warn(
        `⚠️ [Redis RTT] Falha ao medir latência: ${err?.message || err}`
      );
    }
  };

  // Medir já na inicialização e depois a cada 60s
  probe();
  latencyMonitorInterval = setInterval(probe, 60000);
  latencyMonitorInterval.unref?.();
}

/**
 * Cria configurações Redis robustas otimizadas para BullMQ
 */
function createRedisOptions(): IORedisOptions {
  // Preferir URL TCP direta (mais robusta)
  const tcpUrl = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL;

  if (tcpUrl) {
    try {
      const u = new URL(tcpUrl);
      const isTls = u.protocol === "rediss:";

      console.log(`🔧 [Redis] Usando TCP URL: ${u.hostname}:${u.port || 6379}`);

      return {
        host: u.hostname,
        port: Number(u.port || 6379),
        username: u.username || "default",
        password: decodeURIComponent(u.password || ""),
        family: 0, // 0 = IPv4 e IPv6, 4 = apenas IPv4, 6 = apenas IPv6
        maxRetriesPerRequest: null, // Importante para BullMQ (comandos bloqueantes)
        enableReadyCheck: false,
        connectTimeout: 10000,
        keepAlive: 60000,
        tls: isTls ? { rejectUnauthorized: true } : undefined, // ✅ Segurança
        retryStrategy: (times) => {
          // Backoff exponencial com jitter
          const baseDelay = Math.min(2000, times * 200);
          const jitter = Math.floor(Math.random() * 200);
          return baseDelay + jitter;
        },
        reconnectOnError: (err) => {
          // Reconectar em erros específicos do Redis
          const msg = err?.message || "";
          return /READONLY|MOVED|CLUSTERDOWN|ECONNRESET|ETIMEDOUT/.test(msg);
        },
        enableOfflineQueue: process.env.ROLE === "producer", // ❌ Desabilitado para workers
        lazyConnect: false,
        autoResubscribe: true,
        autoResendUnfulfilledCommands: false,
      };
    } catch (e) {
      console.warn("⚠️ [Redis] URL TCP inválida, caindo para REST derivado");
    }
  }

  // Fallback: derivar do REST
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !token) {
    throw new Error(
      "Configure UPSTASH_REDIS_URL/REDIS_URL (recomendado) ou UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN"
    );
  }

  const hostname = restUrl.replace("https://", "");
  console.log(`� [Redis] Derivando TCP de REST: ${hostname}:6379`);

  return {
    host: hostname,
    port: 6379,
    username: "default",
    password: token,
    family: 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10000,
    keepAlive: 60000,
    tls: { rejectUnauthorized: true }, // ✅ Segurança
    retryStrategy: (times) => {
      const baseDelay = Math.min(2000, times * 200);
      const jitter = Math.floor(Math.random() * 200);
      return baseDelay + jitter;
    },
    reconnectOnError: (err) => {
      const msg = err?.message || "";
      return /READONLY|MOVED|CLUSTERDOWN|ECONNRESET|ETIMEDOUT/.test(msg);
    },
    enableOfflineQueue: process.env.ROLE === "producer", // ❌ Desabilitado para workers
    lazyConnect: false,
    autoResubscribe: true,
    autoResendUnfulfilledCommands: false,
  };
}

/**
 * Cria conexão Redis compatível com BullMQ
 */
function createRedisConnection(): IORedis {
  const options = createRedisOptions();

  console.log("🔄 [Redis] Criando conexão TCP para BullMQ");
  console.log(
    `� [Redis] Config: ${JSON.stringify({
      host: options.host,
      port: options.port,
      enableOfflineQueue: options.enableOfflineQueue,
      maxRetriesPerRequest: options.maxRetriesPerRequest,
      tls: !!options.tls,
    })}`
  );

  const ioredis = new IORedis(options);

  // Event listeners com logs estruturados
  ioredis.on("error", (err: any) => {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "redis-connection",
        event: "connection_error",
        error: err.message,
        command: err.command || null,
      })
    );
  });

  ioredis.on("connect", () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "redis-connection",
        event: "connected",
        host: options.host,
        port: options.port,
        tls: !!options.tls,
      })
    );
  });

  ioredis.on("ready", () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "redis-connection",
        event: "ready",
      })
    );
  });

  ioredis.on("reconnecting", (delay: number) => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        service: "redis-connection",
        event: "reconnecting",
        delay_ms: delay,
      })
    );
  });

  ioredis.on("close", () => {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        service: "redis-connection",
        event: "connection_closed",
      })
    );
  });

  // Criar cliente Upstash REST se necessário
  if (!upstashClient) {
    const restUrl = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (restUrl && token) {
      upstashClient = new Redis({ url: restUrl, token });

      // Monitor de latência
      try {
        const hostname = options.host || "unknown";
        startRedisLatencyMonitor(ioredis, upstashClient, hostname);
      } catch {}
    }
  }

  return ioredis;
}

/**
 * ✅ ATUALIZADO: Singleton usando a nova fábrica de clientes
 * Evita múltiplas conexões e garante configurações consistentes
 */
export function getRedisConnection(): IORedis {
  if (!redisConnection) {
    console.log("🎯 [Redis] Criando singleton usando factory...");
    redisConnection = createRedisClient(); // ✅ Usar nova fábrica
    console.log("✅ [Redis] Singleton criado com factory");
  }
  return redisConnection;
}

/**
 * ✅ ATUALIZADO: Instância única usando nova fábrica
 * Usado por BaseWorker e BaseQueue para conexão normal
 */
export const redisConn = getRedisConnection();

/**
 * Cliente Upstash REST direto (para operações que não precisam de TCP)
 */
export function getUpstashClient(): Redis {
  if (!upstashClient) {
    const restUrl = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!restUrl || !token) {
      throw new Error("Upstash credentials não configuradas");
    }

    upstashClient = new Redis({ url: restUrl, token });
  }
  return upstashClient;
}

/**
 * ✅ ATUALIZADO: Verifica conectividade Redis usando fábrica
 * Usado no healthcheck para verificação real
 */
export async function pingRedis(): Promise<{ ok: boolean; rtt_ms: number }> {
  // Usar cliente temporário para ping (não interferir com singleton)
  const tempClient = createRedisClient();

  try {
    const start = Date.now();
    const pong = await tempClient.ping();
    const rtt = Date.now() - start;

    return {
      ok: pong === "PONG",
      rtt_ms: rtt,
    };
  } catch (error: any) {
    throw new Error(`Redis ping failed: ${error.message}`);
  } finally {
    try {
      await tempClient.quit();
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Fecha conexão Redis gracefully
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisConnection) {
    console.log("🔌 [Redis] Fechando conexão...");

    try {
      // Parar monitor de latência
      if (latencyMonitorInterval) {
        clearInterval(latencyMonitorInterval);
        latencyMonitorInterval = null;
      }

      // Fechar conexão gracefully
      await redisConnection.quit();
      redisConnection = null;

      console.log("✅ [Redis] Conexão fechada gracefully");
    } catch (error: any) {
      console.error("⚠️ [Redis] Erro ao fechar conexão:", error.message);
      // Force disconnect em caso de erro
      try {
        if (redisConnection) {
          redisConnection.disconnect();
        }
      } catch {}
      redisConnection = null;
    }
  }

  // Reset globals
  latencyMonitorStarted = false;
  upstashClient = null;
}
