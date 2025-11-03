// src/lib/queue/connection.ts
import { Redis } from "@upstash/redis";
import IORedis from "ioredis";

let redisConnection: IORedis | null = null;
let upstashClient: Redis | null = null;
let latencyMonitorStarted = false;

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
  setInterval(probe, 60000).unref?.();
}

/**
 * Cria conexão Redis compatível com BullMQ
 */
function createRedisConnection(): IORedis {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !token) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN são obrigatórios"
    );
  }

  console.log("🔧 [Redis] Inicializando Upstash Redis");
  console.log(`📡 [Redis] URL: ${restUrl}`);

  // Criar cliente Upstash REST
  upstashClient = new Redis({
    url: restUrl,
    token: token,
  });

  console.log("✅ [Redis] Cliente Upstash REST criado");

  // BullMQ precisa de conexão TCP
  const hostname = restUrl.replace("https://", "");
  const redisUrl = `rediss://default:${token}@${hostname}:6379`;

  console.log(`🔄 [Redis] Criando conexão TCP para BullMQ: ${hostname}:6379`);

  const ioredis = new IORedis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    connectTimeout: 10000,
    commandTimeout: 5000,
    keepAlive: 60000,
    retryStrategy: (times: number) => {
      if (times > 4) {
        console.error(
          `❌ [Redis TCP] Desistindo após ${times} tentativas`
        );
        return null;
      }
      const delay = Math.min(1000 * Math.pow(2, times - 1), 8000);
      console.log(`🔄 [Redis TCP] Tentativa ${times}, aguardando ${delay}ms...`);
      return delay;
    },
    tls: {
      rejectUnauthorized: false,
    },
    enableOfflineQueue: false,
    autoResubscribe: true,
    autoResendUnfulfilledCommands: false,
    reconnectOnError: (err) => {
      const msg = err.message || "";
      if (
        msg.includes("READONLY") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT")
      ) {
        console.warn(`🔁 [Redis TCP] Reconnect on error: ${msg}`);
        return true;
      }
      return false;
    },
    lazyConnect: false,
  });

  ioredis.on("error", (err) => {
    console.error("❌ [Redis TCP] Erro:", err.message);
  });

  ioredis.on("connect", () => {
    console.log("✅ [Redis TCP] Conectado ao Upstash (porta 6379)");
  });

  ioredis.on("ready", () => {
    console.log("🚀 [Redis TCP] Pronto para operações BullMQ");
  });

  ioredis.on("reconnecting", () => {
    console.log("🔄 [Redis TCP] Reconectando...");
  });

  ioredis.on("close", () => {
    console.warn("⚠️ [Redis TCP] Conexão fechada");
  });

  // Monitor de latência
  try {
    startRedisLatencyMonitor(ioredis, upstashClient!, hostname);
  } catch {}

  return ioredis;
}

/**
 * Singleton para conexão Redis
 */
export function getRedisConnection(): IORedis {
  if (!redisConnection) {
    console.log("🎯 [Redis] Criando singleton de conexão...");
    redisConnection = createRedisConnection();
    console.log("✅ [Redis] Singleton criado");
  }
  return redisConnection;
}

/**
 * Cliente Upstash REST direto
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
 * Fecha conexão Redis gracefully
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisConnection) {
    console.log("🔌 [Redis] Fechando conexão...");
    await redisConnection.quit();
    redisConnection = null;
    console.log("✅ [Redis] Conexão fechada");
  }
}
