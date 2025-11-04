// src/lib/queue/webhookWorker.ts
import { Job } from "bullmq";
import { BaseWorker } from "./BaseWorker";
import { sendCallback } from "../callbackSender";
import { WorkerCallbackPayload } from "../types";

/**
 * Dados específicos para jobs de webhook
 * ✅ ATUALIZADO: Suporta formato antigo E novo (destination/callback)
 */
export interface WebhookJobData {
  // Campos obrigatórios (compatibilidade retroativa)
  tenantId: number;
  integrationId?: number; // ✅ Agora opcional (para emails, etc)
  integrationName?: string;
  negocioId?: number;

  // Formato ANTIGO (compatibilidade retroativa)
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timestamp?: string;

  // 🆕 Formato NOVO (padronizado)
  jobType?: "webhook" | "email" | "sms" | "notification";
  destination?: {
    url: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    headers?: Record<string, string>;
    body?: any;
    timeout?: number;
  };
  callback?: {
    url: string; // URL enviada pelo Next.js
    secret?: string; // HMAC específico (opcional)
  };
  metadata?: Record<string, any>;
}

/**
 * Circuit Breaker simples para webhooks
 */
class WebhookCircuitBreaker {
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private readonly threshold = 5; // 5 falhas consecutivas para abrir
  private readonly timeout = 60000; // 1 minuto de pausa
  private readonly resetSuccesses = 3; // 3 sucessos para resetar contador

  isOpen(): boolean {
    if (this.failures >= this.threshold) {
      if (Date.now() - this.lastFailureTime < this.timeout) {
        return true; // Circuit aberto (pausado)
      } else {
        // Timeout passou, tentar novamente
        this.failures = Math.max(0, this.failures - 1);
      }
    }
    return false;
  }

  recordSuccess(): void {
    this.successes++;
    if (this.successes >= this.resetSuccesses) {
      this.failures = 0;
      this.successes = 0;
    }
  }

  recordFailure(): void {
    this.failures++;
    this.successes = 0;
    this.lastFailureTime = Date.now();
  }

  getStats() {
    return {
      failures: this.failures,
      successes: this.successes,
      isOpen: this.isOpen(),
      lastFailureTime: this.lastFailureTime,
    };
  }
}

// Circuit breaker global para webhooks
const circuitBreaker = new WebhookCircuitBreaker();

/**
 * Salva log de webhook via API interna com timeout robusto e AbortController
 * ✅ ATUALIZADO: integrationId agora é opcional (para emails, SMS, etc)
 */
async function saveWebhookLog(logData: {
  integrationId?: number;
  negocioId?: number;
  tenantId: number;
  url: string;
  method: string;
  statusCode: number | null;
  success: boolean;
  errorMessage: string | null;
  requestBody: string;
  responseBody: string | null;
  duration: number;
  attemptNumber: number;
}): Promise<void> {
  const apiUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  const apiSecret = process.env.QUEUE_WORKER_SECRET;

  // ✅ APP_URL é OPCIONAL - se não configurado, apenas não salva o log antigo
  if (!apiUrl) {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        service: "webhook-logger",
        event: "app_url_not_configured",
        message: "APP_URL not set - skipping legacy webhook log save",
        tenant_id: logData.tenantId,
        integration_id: logData.integrationId,
      })
    );
    return;
  }

  // ✅ QUEUE_WORKER_SECRET também é opcional para saveWebhookLog
  if (!apiSecret) {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        service: "webhook-logger",
        event: "worker_secret_not_configured",
        message:
          "QUEUE_WORKER_SECRET not set - skipping legacy webhook log save",
        tenant_id: logData.tenantId,
        integration_id: logData.integrationId,
      })
    );
    return;
  }

  // ✅ AbortController com timeout 5s
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const startTime = Date.now();

    const bodyData = JSON.stringify(logData);

    const response = await fetch(`${apiUrl}/api/internal/webhook-logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiSecret}`, // ✅ Bearer Token
      },
      body: bodyData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "webhook-logger",
          event: "api_error",
          tenant_id: logData.tenantId,
          integration_id: logData.integrationId,
          api_status: response.status,
          api_error: errorText,
          duration_ms: duration,
        })
      );
      return;
    }

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "webhook-logger",
        event: "log_saved",
        tenant_id: logData.tenantId,
        integration_id: logData.integrationId,
        duration_ms: duration,
      })
    );
  } catch (error: any) {
    clearTimeout(timeoutId);

    const errorType = error.name === "AbortError" ? "timeout" : "network_error";

    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "webhook-logger",
        event: errorType,
        tenant_id: logData.tenantId,
        integration_id: logData.integrationId,
        error: error.message,
      })
    );
  }
}

/**
 * Worker especializado para processar webhooks com resiliência e circuit breaker
 */
class WebhookWorker extends BaseWorker<WebhookJobData> {
  constructor() {
    super("webhooks", {
      concurrency: parseInt(process.env.WORKER_CONCURRENCY || "10", 10),
      limiter: {
        max: 50, // ✅ Limite mais robusto
        duration: 1000,
      },
      lockDuration: 60000, // ✅ 60s lock duration
      stalledInterval: 30000, // ✅ 30s stalled interval
      maxStalledCount: 2,
    });
  }

  protected async processJob(job: Job<WebhookJobData>): Promise<any> {
    // ✅ Normalizar payload (suportar formato antigo E novo)
    const isNewFormat = !!job.data.destination;

    const { tenantId, integrationId, integrationName, negocioId, metadata } =
      job.data;

    // Extrair destination (novo formato) ou usar campos antigos
    const url = isNewFormat ? job.data.destination!.url : job.data.url!;
    const method = isNewFormat
      ? job.data.destination!.method
      : job.data.method || "POST";
    const headers = isNewFormat
      ? job.data.destination!.headers || {}
      : job.data.headers || {};
    const body = isNewFormat ? job.data.destination!.body : job.data.body;
    const jobType = job.data.jobType || "webhook";

    // Extrair callback URL (se existir)
    const callbackUrl = job.data.callback?.url;
    const callbackSecret =
      job.data.callback?.secret || process.env.QUEUE_WORKER_SECRET || "";

    const attemptNumber = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts || 5;
    const jobId = job.id || "unknown";
    const startedAt = new Date();

    // ✅ Verificar circuit breaker
    if (circuitBreaker.isOpen()) {
      const stats = circuitBreaker.getStats();
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "webhook-worker",
          event: "circuit_breaker_open",
          queue: "webhooks",
          job_id: jobId,
          tenant_id: tenantId,
          integration_id: integrationId,
          circuit_breaker_stats: stats,
        })
      );

      throw new Error(`Circuit breaker is open. Failures: ${stats.failures}`);
    }

    // Log de início estruturado
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "webhook-worker",
        event: "webhook_attempt_started",
        queue: "webhooks",
        job_id: jobId,
        tenant_id: tenantId,
        integration_id: integrationId,
        integration_name: integrationName,
        webhook_url: url,
        attempt: attemptNumber,
        max_attempts: maxAttempts,
      })
    );

    const startTime = Date.now();
    let success = false;
    let statusCode: number | null = null;
    let responseBody: any = null;
    let errorMessage: string | null = null;

    try {
      // ✅ AbortController com timeout 12s
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "webhook-worker",
          event: "http_request_started",
          job_id: jobId,
          tenant_id: tenantId,
          integration_id: integrationId,
          url,
          method: method || "POST",
        })
      );

      const response = await fetch(url, {
        method: method || "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      statusCode = response.status;
      success = response.ok;

      // Capturar resposta
      try {
        const responseText = await response.text();
        if (responseText) {
          try {
            responseBody = JSON.parse(responseText);
          } catch {
            responseBody = { raw: responseText };
          }
        }
      } catch (err: any) {
        errorMessage = err.message;
      }

      const duration = Date.now() - startTime;

      if (success) {
        // ✅ Registrar sucesso no circuit breaker
        circuitBreaker.recordSuccess();

        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "info",
            service: "webhook-worker",
            event: "webhook_success",
            queue: "webhooks",
            job_id: jobId,
            tenant_id: tenantId,
            integration_id: integrationId,
            webhook_url: url,
            http_status: statusCode,
            duration_ms: duration,
            attempt: attemptNumber,
            max_attempts: maxAttempts,
          })
        );

        // 🆕 ENVIAR CALLBACK DE SUCESSO
        if (callbackUrl && callbackSecret) {
          const callbackPayload: WorkerCallbackPayload = {
            jobId,
            jobType: jobType as any,
            tenantId,
            integrationId,
            negocioId,
            status: "success",
            success: true,
            destination: {
              url,
              method,
              statusCode,
              headers: Object.fromEntries(response.headers.entries()),
              body: responseBody,
              duration,
            },
            execution: {
              attempt: attemptNumber,
              maxAttempts,
              startedAt: startedAt.toISOString(),
              completedAt: new Date().toISOString(),
              duration,
            },
            metadata,
          };

          // Enviar callback (não bloquear o job se falhar)
          sendCallback(callbackPayload, callbackUrl, callbackSecret).catch(
            (err) => {
              console.error(
                JSON.stringify({
                  timestamp: new Date().toISOString(),
                  level: "error",
                  service: "webhook-worker",
                  event: "callback_send_failed",
                  job_id: jobId,
                  error: err.message,
                })
              );
            }
          );
        }
      } else {
        // ✅ Registrar falha no circuit breaker
        circuitBreaker.recordFailure();

        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "error",
            service: "webhook-worker",
            event: "webhook_http_error",
            queue: "webhooks",
            job_id: jobId,
            tenant_id: tenantId,
            integration_id: integrationId,
            webhook_url: url,
            http_status: statusCode,
            http_status_text: response.statusText,
            duration_ms: duration,
            attempt: attemptNumber,
            max_attempts: maxAttempts,
          })
        );
      }

      // Salvar log via API interna
      await saveWebhookLog({
        integrationId: integrationId || undefined,
        negocioId: negocioId || undefined,
        tenantId,
        url,
        method: method || "POST",
        statusCode: statusCode,
        success,
        errorMessage: success
          ? null
          : `HTTP ${statusCode}: ${response.statusText}`,
        requestBody: JSON.stringify(body),
        responseBody: responseBody ? JSON.stringify(responseBody) : null,
        duration,
        attemptNumber,
      });

      if (!success) {
        throw new Error(`HTTP ${statusCode}: ${response.statusText}`);
      }

      return { statusCode, success, duration };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      errorMessage = error.message;

      // ✅ Registrar falha no circuit breaker
      circuitBreaker.recordFailure();

      // Categorizar erro
      let errorCategory = "UNKNOWN_ERROR";
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        errorCategory = "TIMEOUT";
      } else if (error.message?.includes("fetch failed")) {
        errorCategory = "CONNECTION_FAILED";
      } else if (error.message?.includes("ENOTFOUND")) {
        errorCategory = "DNS_ERROR";
      } else if (error.message?.includes("ECONNREFUSED")) {
        errorCategory = "CONNECTION_REFUSED";
      }

      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "webhook-worker",
          event: "webhook_error",
          queue: "webhooks",
          job_id: jobId,
          tenant_id: tenantId,
          integration_id: integrationId,
          webhook_url: url,
          error_category: errorCategory,
          error_message: errorMessage,
          duration_ms: duration,
          attempt: attemptNumber,
          max_attempts: maxAttempts,
          will_retry: attemptNumber < maxAttempts,
          circuit_breaker_stats: circuitBreaker.getStats(),
        })
      );

      // Salvar erro via API interna
      await saveWebhookLog({
        integrationId: integrationId || undefined,
        negocioId: negocioId || undefined,
        tenantId,
        url,
        method: method || "POST",
        statusCode: statusCode || 0,
        success: false,
        errorMessage,
        requestBody: JSON.stringify(body),
        responseBody: null,
        duration,
        attemptNumber,
      });

      // 🆕 ENVIAR CALLBACK DE ERRO/RETRY
      if (callbackUrl && callbackSecret) {
        const willRetry = attemptNumber < maxAttempts;
        const isRetryable = [
          "TIMEOUT",
          "CONNECTION_FAILED",
          "DNS_ERROR",
          "CONNECTION_REFUSED",
        ].includes(errorCategory);

        const callbackPayload: WorkerCallbackPayload = {
          jobId,
          jobType: jobType as any,
          tenantId,
          integrationId,
          negocioId,
          status: willRetry ? "retrying" : "failed",
          success: false,
          destination: {
            url,
            method,
            statusCode: statusCode || 0,
            duration,
          },
          error: {
            message: errorMessage || "Unknown error",
            code: errorCategory,
            isRetryable,
          },
          execution: {
            attempt: attemptNumber,
            maxAttempts,
            startedAt: startedAt.toISOString(),
            completedAt: new Date().toISOString(),
            duration,
            nextRetryAt: willRetry
              ? new Date(
                  Date.now() + Math.pow(2, attemptNumber) * 2000
                ).toISOString()
              : undefined,
          },
          metadata,
        };

        // Enviar callback (não bloquear o job se falhar)
        sendCallback(callbackPayload, callbackUrl, callbackSecret).catch(
          (err) => {
            console.error(
              JSON.stringify({
                timestamp: new Date().toISOString(),
                level: "error",
                service: "webhook-worker",
                event: "callback_send_failed",
                job_id: jobId,
                error: err.message,
              })
            );
          }
        );
      }

      // Re-throw para BullMQ fazer retry
      throw error;
    }
  }
}

// Singleton
export let webhookWorker: WebhookWorker;

export function startWebhookWorker(): WebhookWorker {
  if (!webhookWorker) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "webhook-worker",
        event: "worker_starting",
      })
    );

    webhookWorker = new WebhookWorker();

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "webhook-worker",
        event: "worker_started",
        circuit_breaker_stats: circuitBreaker.getStats(),
      })
    );
  }
  return webhookWorker;
}

export async function stopWebhookWorker(): Promise<void> {
  if (webhookWorker) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "webhook-worker",
        event: "worker_stopping",
        circuit_breaker_stats: circuitBreaker.getStats(),
      })
    );

    await webhookWorker.stop();

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "webhook-worker",
        event: "worker_stopped",
      })
    );
  }
}
