/**
 * BullMQ Worker Standalone Process
 *
 * Processo independente responsável por consumir jobs das filas BullMQ.
 * Deployável em Railway, VPS, Render, Fly.io ou qualquer container runtime.
 *
 * @author Convex Team
 * @version 1.0.0
 */

import http from "http";
import {
  startWebhookWorker,
  stopWebhookWorker,
  webhookWorker,
} from "./lib/queue/webhookWorker";
import {
  getRedisSingleton,
  waitForReady,
  pingRedisSafe,
} from "./lib/queue/connection";

// ============================================================================
// Global State
// ============================================================================

const startTime = Date.now();
let isShuttingDown = false;
let healthServer: http.Server | null = null;

// ============================================================================
// Health & Metrics
// ============================================================================

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  workers: {
    webhook: {
      active: boolean;
      paused: boolean;
    };
  };
  redis: {
    connected: boolean;
    rtt_ms?: number;
  };
  timestamp: string;
}

async function getHealthStatus(): Promise<HealthStatus> {
  const isActive = webhookWorker?.isActive() || false;
  const isPaused = webhookWorker ? await webhookWorker.isPaused() : true;

  // ✅ Verificação real do Redis usando singleton
  let redisConnected = false;
  let redisRtt: number | undefined;

  try {
    const redis = getRedisSingleton();
    const startPing = Date.now();
    await pingRedisSafe(redis, 1500);
    redisRtt = Date.now() - startPing;
    redisConnected = true;
  } catch (error: any) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "health-check",
        event: "redis_ping_failed",
        error: error.message,
      })
    );
    redisConnected = false;
  }

  // Determinar status geral
  let status: "healthy" | "degraded" | "unhealthy";
  if (isShuttingDown) {
    status = "unhealthy";
  } else if (redisConnected && isActive) {
    status = "healthy";
  } else {
    status = "degraded";
  }

  return {
    status,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    workers: {
      webhook: {
        active: isActive,
        paused: isPaused,
      },
    },
    redis: {
      connected: redisConnected,
      rtt_ms: redisRtt,
    },
    timestamp: new Date().toISOString(),
  };
}

function createHealthServer(port: number = 3001) {
  const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // Normalize URL path (ignore trailing slash and query params)
    const urlObj = new URL(req.url || "/", "http://localhost");
    const path = urlObj.pathname.replace(/\/$/, "");

    // Health endpoint - ✅ Verificação real Redis + Worker
    if (path === "/health" && req.method === "GET") {
      try {
        const health = await getHealthStatus();
        // ✅ Retorna 200 apenas se Redis responder PONG e worker estiver ativo
        const statusCode =
          health.status === "healthy" && health.redis.connected ? 200 : 503;

        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(JSON.stringify(health, null, 2));

        // Log estruturado do health check
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: statusCode === 200 ? "info" : "warn",
            service: "health-server",
            event: "health_check",
            status: health.status,
            http_status: statusCode,
            redis_connected: health.redis.connected,
            redis_rtt_ms: health.redis.rtt_ms,
            worker_active: health.workers.webhook.active,
          })
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "error",
            service: "health-server",
            event: "health_check_error",
            error: error instanceof Error ? error.message : String(error),
          })
        );

        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "unhealthy",
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
      return;
    }

    // Redis ping diagnostics - ✅ Usando função pingRedisSafe robusta
    if (path === "/redis" && req.method === "GET") {
      try {
        const redis = getRedisSingleton();
        const startPing = Date.now();
        await pingRedisSafe(redis, 1500);
        const rttMs = Date.now() - startPing;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            redis: "ok",
            rtt_ms: rttMs,
            timestamp: new Date().toISOString(),
          })
        );
      } catch (error: any) {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "error",
            service: "health-server",
            event: "redis_diagnostic_failed",
            error: error.message,
          })
        );

        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            redis: "fail",
            error: error.message,
            timestamp: new Date().toISOString(),
          })
        );
      }
      return;
    }

    // Readiness endpoint (Railway/K8s)
    if (path === "/ready" && req.method === "GET") {
      try {
        const health = await getHealthStatus();
        const isReady = health.status === "healthy" && !isShuttingDown;

        res.writeHead(isReady ? 200 : 503, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify({ ready: isReady }));
      } catch (error) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ready: false }));
      }
      return;
    }

    // Liveness endpoint (Railway/K8s)
    if (path === "/live" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ alive: true }));
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", path, method: req.method }));
  });

  server.listen(port, () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "health-server",
        event: "server_listening",
        port,
        endpoints: ["/health", "/ready", "/live", "/redis"],
      })
    );
  });

  return server;
}

// ============================================================================
// Graceful Shutdown - ✅ Robusto e completo
// ============================================================================

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        service: "main",
        event: "shutdown_already_in_progress",
        signal,
      })
    );

    // Force exit após 10s se já está fazendo shutdown
    setTimeout(() => {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "main",
          event: "force_exit",
          reason: "shutdown_timeout",
        })
      );
      process.exit(1);
    }, 10000);
    return;
  }

  isShuttingDown = true;

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      service: "main",
      event: "graceful_shutdown_started",
      signal,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    })
  );

  // Timeout global para shutdown (30s máximo)
  const shutdownTimeout = setTimeout(() => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "main",
        event: "shutdown_timeout",
        timeout_seconds: 30,
      })
    );
    process.exit(1);
  }, 30000);

  try {
    // 1. Parar de aceitar novos health checks como "healthy"
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "main",
        event: "health_checks_degraded",
      })
    );

    // 2. Parar workers (aguardar jobs completarem)
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "main",
        event: "stopping_workers",
      })
    );

    await stopWebhookWorker();

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "main",
        event: "workers_stopped",
      })
    );

    // 3. Fechar conexões Redis (singleton compartilhada)
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "main",
        event: "closing_redis_connections",
      })
    );

    // ✅ Fechar singleton Redis
    const redis = getRedisSingleton();
    await redis.quit().catch((err) => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "main",
          event: "redis_close_error",
          error: err.message,
        })
      );
    });

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "main",
        event: "redis_connections_closed",
      })
    );

    // 4. Fechar health server
    if (healthServer) {
      await new Promise<void>((resolve) => {
        healthServer!.close(() => {
          console.log(
            JSON.stringify({
              timestamp: new Date().toISOString(),
              level: "info",
              service: "main",
              event: "health_server_closed",
            })
          );
          resolve();
        });
      });
    }

    clearTimeout(shutdownTimeout);

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "main",
        event: "graceful_shutdown_completed",
        total_uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      })
    );

    process.exit(0);
  } catch (error) {
    clearTimeout(shutdownTimeout);

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "main",
        event: "shutdown_error",
        error: error instanceof Error ? error.message : String(error),
      })
    );

    process.exit(1);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      service: "main",
      event: "worker_process_starting",
      node_version: process.version,
      platform: process.platform,
      environment: process.env.NODE_ENV || "production",
      pid: process.pid,
    })
  );

  try {
    // 1. Verificar variáveis de ambiente obrigatórias
    const requiredEnvs = ["INTERNAL_API_SECRET"];

    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      requiredEnvs.push("APP_URL ou NEXT_PUBLIC_APP_URL");
    }

    const hasTcpRedis = Boolean(
      process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL
    );
    const hasRestRedis = Boolean(
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    );

    if (!hasTcpRedis && !hasRestRedis) {
      requiredEnvs.push(
        "UPSTASH_REDIS_URL/REDIS_URL ou UPSTASH_REDIS_REST_URL+UPSTASH_REDIS_REST_TOKEN"
      );
    }

    for (const env of requiredEnvs) {
      if (env.includes("ou ") || !process.env[env as keyof NodeJS.ProcessEnv]) {
        throw new Error(`Missing required environment variable: ${env}`);
      }
    }

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "main",
        event: "environment_validated",
        redis_source: hasTcpRedis ? "tcp_url" : "rest_derived",
        app_url: appUrl,
      })
    );

    // 2. Testar conectividade com Redis (PING)
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "main",
        event: "testing_redis_connectivity",
      })
    );

    // ✅ Usar singleton + waitForReady + pingRedisSafe
    const redis = getRedisSingleton();
    await waitForReady(redis, 5000);

    const startPing = Date.now();
    await pingRedisSafe(redis, 1500);
    const rttMs = Date.now() - startPing;

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "main",
        event: "redis_connectivity_verified",
        rtt_ms: rttMs,
      })
    );

    // 3. Inicializar workers
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "main",
        event: "initializing_workers",
      })
    );

    startWebhookWorker();
    await webhookWorker.waitUntilReady();

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "main",
        event: "workers_ready",
      })
    );

    // 4. Iniciar health server
    const port = parseInt(process.env.PORT || "3001", 10);
    healthServer = createHealthServer(port);

    // 5. ✅ Signal handlers robustos
    process.on("SIGTERM", () => {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "main",
          event: "signal_received",
          signal: "SIGTERM",
        })
      );
      gracefulShutdown("SIGTERM");
    });

    process.on("SIGINT", () => {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "main",
          event: "signal_received",
          signal: "SIGINT",
        })
      );
      gracefulShutdown("SIGINT");
    });

    // 6. ✅ Error handlers robustos
    process.on("uncaughtException", (error) => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "main",
          event: "uncaught_exception",
          error: error.message,
          stack: error.stack?.split("\n").slice(0, 10).join(" | "),
        })
      );
      gracefulShutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason) => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "main",
          event: "unhandled_rejection",
          reason: reason instanceof Error ? reason.message : String(reason),
          stack:
            reason instanceof Error
              ? reason.stack?.split("\n").slice(0, 10).join(" | ")
              : undefined,
        })
      );
      gracefulShutdown("unhandledRejection");
    });

    // 7. Success log
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "main",
        event: "worker_process_ready",
        workers: ["webhook"],
        health_port: port,
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "main",
        event: "startup_failed",
        error: error instanceof Error ? error.message : String(error),
        stack:
          error instanceof Error
            ? error.stack?.split("\n").slice(0, 10).join(" | ")
            : undefined,
      })
    );
    process.exit(1);
  }
}

// ============================================================================
// Bootstrap
// ============================================================================

main().catch((error) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "main",
      event: "bootstrap_error",
      error: error instanceof Error ? error.message : String(error),
      stack:
        error instanceof Error
          ? error.stack?.split("\n").slice(0, 10).join(" | ")
          : undefined,
    })
  );
  process.exit(1);
});
