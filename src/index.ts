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
// Metrics Tracking
// ============================================================================

interface Metrics {
  jobs: {
    processed: number;
    failed: number;
    totalDurationMs: number;
    avgDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    lastProcessedAt: string | null;
  };
  performance: {
    jobsPerSecond: number;
    jobsLastMinute: number;
    jobsLastHour: number;
  };
  errors: {
    count: number;
    lastError: string | null;
    lastErrorAt: string | null;
  };
}

const metrics: Metrics = {
  jobs: {
    processed: 0,
    failed: 0,
    totalDurationMs: 0,
    avgDurationMs: 0,
    minDurationMs: Infinity,
    maxDurationMs: 0,
    lastProcessedAt: null,
  },
  performance: {
    jobsPerSecond: 0,
    jobsLastMinute: 0,
    jobsLastHour: 0,
  },
  errors: {
    count: 0,
    lastError: null,
    lastErrorAt: null,
  },
};

// Contadores para cálculo de taxa
const recentJobs: { timestamp: number }[] = [];

/**
 * Registra processamento de job bem-sucedido
 */
export function recordJobSuccess(durationMs: number) {
  metrics.jobs.processed++;
  metrics.jobs.totalDurationMs += durationMs;
  metrics.jobs.avgDurationMs =
    metrics.jobs.totalDurationMs / metrics.jobs.processed;
  metrics.jobs.minDurationMs = Math.min(metrics.jobs.minDurationMs, durationMs);
  metrics.jobs.maxDurationMs = Math.max(metrics.jobs.maxDurationMs, durationMs);
  metrics.jobs.lastProcessedAt = new Date().toISOString();

  // Adicionar ao histórico recente
  recentJobs.push({ timestamp: Date.now() });

  // Limpar jobs antigos (mais de 1 hora)
  const oneHourAgo = Date.now() - 3600000;
  while (recentJobs.length > 0 && recentJobs[0].timestamp < oneHourAgo) {
    recentJobs.shift();
  }
}

/**
 * Registra falha de job
 */
export function recordJobFailure(error: string) {
  metrics.jobs.failed++;
  metrics.errors.count++;
  metrics.errors.lastError = error.substring(0, 200);
  metrics.errors.lastErrorAt = new Date().toISOString();
}

/**
 * Calcula métricas de performance em tempo real
 */
function calculatePerformanceMetrics() {
  const now = Date.now();
  const oneSecondAgo = now - 1000;
  const oneMinuteAgo = now - 60000;
  const oneHourAgo = now - 3600000;

  metrics.performance.jobsPerSecond = recentJobs.filter(
    (j) => j.timestamp > oneSecondAgo
  ).length;

  metrics.performance.jobsLastMinute = recentJobs.filter(
    (j) => j.timestamp > oneMinuteAgo
  ).length;

  metrics.performance.jobsLastHour = recentJobs.filter(
    (j) => j.timestamp > oneHourAgo
  ).length;
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

function createHealthServer(port: number = 3002) {
  const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // Normalize URL path (ignore trailing slash and query params)
    const urlObj = new URL(req.url || "/", "http://localhost");
    const path = urlObj.pathname.replace(/\/$/, "");

    // ✅ Health endpoint - /queue/health
    if (path === "/queue/health" && req.method === "GET") {
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

    // ✅ Readiness endpoint - /queue/ready
    if (path === "/queue/ready" && req.method === "GET") {
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

    // ✅ Liveness endpoint - /queue/live
    if (path === "/queue/live" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ alive: true }));
      return;
    }

    // ✅ POST /queue/webhooks/add - Adicionar job de webhook na fila
    if (path === "/queue/webhooks/add" && req.method === "POST") {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", async () => {
        try {
          // 🔐 VALIDAR AUTENTICAÇÃO (suporta Bearer Token OU HMAC)
          const authHeader = req.headers["authorization"] as string;
          const hmacSignature = req.headers["x-webhook-signature"] as string;
          const secret = process.env.QUEUE_WORKER_SECRET;

          if (!secret) {
            console.error(
              JSON.stringify({
                timestamp: new Date().toISOString(),
                level: "error",
                service: "api",
                event: "queue_add_no_secret_configured",
              })
            );
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Server configuration error",
              })
            );
            return;
          }

          // Validar autenticação (aceita Bearer Token OU HMAC)
          let authenticated = false;

          // Opção 1: HMAC Signature (RECOMENDADO - mais seguro)
          if (hmacSignature) {
            const crypto = await import("crypto");
            const expectedSignature = crypto
              .createHmac("sha256", secret)
              .update(body)
              .digest("hex");

            // Timing-safe comparison
            try {
              authenticated = crypto.timingSafeEqual(
                Buffer.from(hmacSignature),
                Buffer.from(expectedSignature)
              );
            } catch {
              authenticated = false;
            }

            if (!authenticated) {
              console.error(
                JSON.stringify({
                  timestamp: new Date().toISOString(),
                  level: "error",
                  service: "api",
                  event: "queue_add_invalid_hmac",
                })
              );
            }
          }
          // Opção 2: Bearer Token (compatibilidade - menos seguro)
          else if (authHeader && authHeader.startsWith("Bearer ")) {
            const token = authHeader.substring(7);
            authenticated = token === secret;

            if (!authenticated) {
              console.error(
                JSON.stringify({
                  timestamp: new Date().toISOString(),
                  level: "error",
                  service: "api",
                  event: "queue_add_invalid_bearer_token",
                })
              );
            }
          }

          // Se nenhuma autenticação fornecida ou ambas inválidas
          if (!authenticated) {
            console.error(
              JSON.stringify({
                timestamp: new Date().toISOString(),
                level: "error",
                service: "api",
                event: "queue_add_unauthorized",
                has_bearer: !!authHeader,
                has_hmac: !!hmacSignature,
              })
            );
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error:
                  "Unauthorized. Use: Authorization: Bearer <token> OR X-Webhook-Signature: <hmac>",
              })
            );
            return;
          }

          const data = JSON.parse(body);

          // ✅ LOG: Sempre logar payload recebido para debug
          console.log(
            JSON.stringify({
              timestamp: new Date().toISOString(),
              level: "info",
              service: "api",
              event: "webhook_request_received",
              payload: data,
              payload_keys: Object.keys(data),
            })
          );

          // 🆕 Detectar formato (antigo ou novo)
          const isNewFormat = !!data.destination;

          // Validação básica (suporta AMBOS os formatos)
          if (!data.tenantId) {
            console.error(
              JSON.stringify({
                timestamp: new Date().toISOString(),
                level: "error",
                service: "api",
                event: "webhook_validation_failed",
                error: "Missing tenantId",
                payload: data,
              })
            );

            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Missing required field: tenantId",
              })
            );
            return;
          }

          // Validar campos obrigatórios conforme formato
          if (isNewFormat) {
            // Formato NOVO: destination obrigatório
            if (!data.destination?.url || !data.destination?.method) {
              console.error(
                JSON.stringify({
                  timestamp: new Date().toISOString(),
                  level: "error",
                  service: "api",
                  event: "webhook_validation_failed",
                  error:
                    "New format missing destination.url or destination.method",
                  payload: data,
                })
              );

              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error:
                    "Missing required fields: destination.url, destination.method",
                })
              );
              return;
            }
          } else {
            // Formato ANTIGO: url, method, integrationId obrigatórios
            if (!data.integrationId || !data.url || !data.method) {
              console.error(
                JSON.stringify({
                  timestamp: new Date().toISOString(),
                  level: "error",
                  service: "api",
                  event: "webhook_validation_failed",
                  error: "Old format missing integrationId, url or method",
                  received_fields: {
                    tenantId: !!data.tenantId,
                    integrationId: !!data.integrationId,
                    url: !!data.url,
                    method: !!data.method,
                  },
                  payload: data,
                })
              );

              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error:
                    "Missing required fields: tenantId, integrationId, url, method",
                  received: Object.keys(data),
                  expected: ["tenantId", "integrationId", "url", "method"],
                })
              );
              return;
            }
          }

          // Adicionar job na fila com estrutura WebhookJobData
          const { Queue } = await import("bullmq");
          const redis = getRedisSingleton();
          const queue = new Queue("webhooks", { connection: redis });

          // 🆕 Payload normalizado (suporta AMBOS os formatos)
          const jobPayload = isNewFormat
            ? {
                // Formato NOVO
                tenantId: data.tenantId,
                integrationId: data.integrationId,
                integrationName: data.integrationName,
                negocioId: data.negocioId,
                jobType: data.jobType || "webhook",
                destination: data.destination,
                callback: data.callback,
                metadata: data.metadata,
                timestamp: new Date().toISOString(),
              }
            : {
                // Formato ANTIGO (compatibilidade retroativa)
                tenantId: data.tenantId,
                integrationId: data.integrationId,
                integrationName: data.integrationName || "Webhook",
                negocioId: data.negocioId,
                url: data.url,
                method: data.method,
                headers: data.headers || {},
                body: data.body || {},
                timestamp: new Date().toISOString(),
              };

          const job = await queue.add("webhook", jobPayload, {
            attempts: data.options?.retries || 5,
            backoff: {
              type: "exponential",
              delay: data.options?.backoff || 2000,
            },
          });

          await queue.close();

          console.log(
            JSON.stringify({
              timestamp: new Date().toISOString(),
              level: "info",
              service: "api",
              event: "webhook_job_added",
              job_id: job.id,
              tenant_id: data.tenantId,
              integration_id: data.integrationId,
              webhook_url: isNewFormat ? data.destination.url : data.url,
              format: isNewFormat ? "new" : "old",
            })
          );

          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              jobId: job.id,
              message: "Webhook job added to queue",
            })
          );
        } catch (error: any) {
          // ✅ LOG: Erro detalhado com stack trace e body recebido
          console.error(
            JSON.stringify({
              timestamp: new Date().toISOString(),
              level: "error",
              service: "api",
              event: "webhook_job_add_failed",
              error: error.message,
              error_stack: error.stack,
              error_name: error.name,
              received_body: body.substring(0, 500), // Primeiros 500 chars
            })
          );

          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Failed to add job to queue",
              message: error.message,
            })
          );
        }
      });
      return;
    }

    // ✅ GET /queue/webhooks/stats - Estatísticas da fila
    if (path === "/queue/webhooks/stats" && req.method === "GET") {
      try {
        const { Queue } = await import("bullmq");
        const redis = getRedisSingleton();
        const queue = new Queue("webhooks", { connection: redis });

        const counts = await queue.getJobCounts(
          "waiting",
          "active",
          "completed",
          "failed",
          "delayed"
        );

        await queue.close();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            queue: "webhooks",
            counts,
            timestamp: new Date().toISOString(),
          })
        );
      } catch (error: any) {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "error",
            service: "api",
            event: "queue_stats_failed",
            error: error.message,
          })
        );

        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Failed to get queue stats",
            message: error.message,
          })
        );
      }
      return;
    }

    // ✅ GET /metrics - Métricas de performance em tempo real
    if (path === "/metrics" && req.method === "GET") {
      try {
        calculatePerformanceMetrics();

        // Obter estatísticas da fila também
        const { Queue } = await import("bullmq");
        const redis = getRedisSingleton();
        const queue = new Queue("webhooks", { connection: redis });
        const counts = await queue.getJobCounts(
          "waiting",
          "active",
          "completed",
          "failed"
        );
        await queue.close();

        // Calcular taxa de sucesso
        const totalJobs = metrics.jobs.processed + metrics.jobs.failed;
        const successRate =
          totalJobs > 0
            ? ((metrics.jobs.processed / totalJobs) * 100).toFixed(2)
            : "0.00";

        // Identificar gargalos
        const bottlenecks: string[] = [];
        if (counts.waiting > 100) {
          bottlenecks.push("HIGH_QUEUE_BACKLOG");
        }
        if (counts.active >= 10) {
          bottlenecks.push("MAX_CONCURRENCY_REACHED");
        }
        if (metrics.jobs.avgDurationMs > 2000) {
          bottlenecks.push("SLOW_WEBHOOK_RESPONSES");
        }
        if (metrics.performance.jobsPerSecond < 1 && counts.waiting > 0) {
          bottlenecks.push("LOW_THROUGHPUT");
        }

        // Recomendações automáticas
        const recommendations: string[] = [];
        if (bottlenecks.includes("MAX_CONCURRENCY_REACHED")) {
          recommendations.push(
            "Increase WORKER_CONCURRENCY to process more jobs simultaneously"
          );
        }
        if (bottlenecks.includes("HIGH_QUEUE_BACKLOG")) {
          recommendations.push(
            "Add more worker instances (horizontal scaling)"
          );
        }
        if (bottlenecks.includes("SLOW_WEBHOOK_RESPONSES")) {
          recommendations.push(
            "Check webhook endpoint performance or add timeout"
          );
        }

        const response = {
          timestamp: new Date().toISOString(),
          uptime: Math.floor((Date.now() - startTime) / 1000),

          // Métricas de jobs
          jobs: {
            ...metrics.jobs,
            minDurationMs:
              metrics.jobs.minDurationMs === Infinity
                ? 0
                : metrics.jobs.minDurationMs,
            successRate: `${successRate}%`,
          },

          // Performance em tempo real
          performance: {
            ...metrics.performance,
            currentThroughput: `${metrics.performance.jobsPerSecond} jobs/second`,
            estimatedCapacity: `${(
              metrics.performance.jobsPerSecond * 60
            ).toFixed(0)} jobs/minute`,
          },

          // Estado da fila
          queue: {
            waiting: counts.waiting,
            active: counts.active,
            completed: counts.completed,
            failed: counts.failed,
            status: counts.waiting > 50 ? "⚠️ Backlog building" : "✅ Healthy",
          },

          // Análise de saúde
          health: {
            bottlenecks: bottlenecks.length > 0 ? bottlenecks : ["NONE"],
            recommendations:
              recommendations.length > 0
                ? recommendations
                : ["System running optimally"],
            needsScaling: counts.waiting > 100 || counts.active >= 10,
          },

          // Erros
          errors: metrics.errors,
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response, null, 2));
      } catch (error: any) {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "error",
            service: "api",
            event: "metrics_failed",
            error: error.message,
          })
        );

        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Failed to get metrics",
            message: error.message,
          })
        );
      }
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
    const requiredEnvs = ["QUEUE_WORKER_SECRET"];

    // ✅ APP_URL não é mais obrigatória (apenas para legacy webhook logs)
    // Se não configurada, o worker funciona normalmente, apenas não salva logs antigos

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
        app_url:
          process.env.APP_URL ||
          process.env.NEXT_PUBLIC_APP_URL ||
          "not_configured",
        queue_worker_secret_set: !!process.env.QUEUE_WORKER_SECRET,
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
    const port = parseInt(process.env.PORT || "3002", 10);
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
