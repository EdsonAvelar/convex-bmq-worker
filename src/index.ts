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
import { startWebhookWorker, stopWebhookWorker, webhookWorker } from "./lib/queue/webhookWorker";
import { closeRedisConnection } from "./lib/queue/connection";
import { disconnectPrisma } from "./lib/db";

// ============================================================================
// Global State
// ============================================================================

const startTime = Date.now();
let isShuttingDown = false;
let healthServer: http.Server | null = null;

// ============================================================================
// Logging
// ============================================================================

function log(level: "info" | "warn" | "error", message: string, meta?: any) {
  const timestamp = new Date().toISOString();
  const logData = {
    timestamp,
    level,
    service: "bullmq-worker",
    message,
    ...meta,
  };

  if (level === "error") {
    console.error(JSON.stringify(logData));
  } else if (level === "warn") {
    console.warn(JSON.stringify(logData));
  } else {
    console.log(JSON.stringify(logData));
  }
}

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
  timestamp: string;
}

async function getHealthStatus(): Promise<HealthStatus> {
  const isActive = await webhookWorker.isActive();
  const isPaused = await webhookWorker.isPaused();

  return {
    status: isShuttingDown ? "unhealthy" : isActive ? "healthy" : "degraded",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    workers: {
      webhook: {
        active: isActive,
        paused: isPaused,
      },
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

    // Health endpoint
    if (req.url === "/health" && req.method === "GET") {
      try {
        const health = await getHealthStatus();
        const statusCode = health.status === "healthy" ? 200 : 503;

        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(JSON.stringify(health, null, 2));
      } catch (error) {
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

    // Readiness endpoint (Railway/K8s)
    if (req.url === "/ready" && req.method === "GET") {
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
    if (req.url === "/live" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ alive: true }));
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, () => {
    log("info", `Health server listening on port ${port}`, {
      endpoints: ["/health", "/ready", "/live"],
    });
  });

  return server;
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    log("warn", "Shutdown already in progress, forcing exit...");
    process.exit(1);
  }

  isShuttingDown = true;
  log("info", `Received ${signal}, starting graceful shutdown...`);

  try {
    // 1. Parar workers (aguardar jobs completarem)
    log("info", "Stopping webhook worker...");
    await stopWebhookWorker();

    // 2. Fechar conexões
    log("info", "Closing Redis connection...");
    await closeRedisConnection();

    log("info", "Closing Prisma connection...");
    await disconnectPrisma();

    // 3. Fechar health server
    if (healthServer) {
      await new Promise<void>((resolve) => {
        healthServer!.close(() => {
          log("info", "Health server closed");
          resolve();
        });
      });
    }

    log("info", "Graceful shutdown completed successfully");
    process.exit(0);
  } catch (error) {
    log("error", "Error during graceful shutdown", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  log("info", "Starting BullMQ Worker Process", {
    nodeVersion: process.version,
    platform: process.platform,
    env: process.env.NODE_ENV || "production",
  });

  try {
    // 1. Verificar variáveis de ambiente
    const requiredEnvs = [
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "DATABASE_URL",
    ];

    const missingEnvs = requiredEnvs.filter((env) => !process.env[env]);
    if (missingEnvs.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingEnvs.join(", ")}`
      );
    }

    // 2. Inicializar workers
    log("info", "Initializing webhook worker...");
    startWebhookWorker();
    await webhookWorker.waitUntilReady();
    log("info", "Webhook worker ready");

    // 3. Iniciar health server
    const port = parseInt(process.env.PORT || "3001", 10);
    healthServer = createHealthServer(port);

    // 4. Signal handlers
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    // 5. Error handlers
    process.on("uncaughtException", (error) => {
      log("error", "Uncaught exception", {
        error: error.message,
        stack: error.stack,
      });
      gracefulShutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason) => {
      log("error", "Unhandled rejection", {
        reason: reason instanceof Error ? reason.message : String(reason),
      });
      gracefulShutdown("unhandledRejection");
    });

    log("info", "✅ BullMQ Worker Process started successfully", {
      workers: ["webhook"],
      healthPort: port,
    });
  } catch (error) {
    log("error", "Failed to start worker process", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// ============================================================================
// Bootstrap
// ============================================================================

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
