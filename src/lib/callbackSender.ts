// src/lib/callbackSender.ts

import { WorkerCallbackPayload } from "./types";

/**
 * Envia callback para o Next.js (ou outro sistema) com Bearer Token
 *
 * @param payload - Dados do resultado do job processado
 * @param callbackUrl - URL completa para onde enviar (vem do payload original)
 * @param secret - QUEUE_WORKER_SECRET para autenticação Bearer
 * @param maxRetries - Número máximo de tentativas (padrão: 3)
 */
export async function sendCallback(
  payload: WorkerCallbackPayload,
  callbackUrl: string,
  secret: string,
  maxRetries: number = 3
): Promise<void> {
  const body = JSON.stringify(payload);

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      service: "callback-sender",
      event: "sending_callback",
      job_id: payload.jobId,
      tenant_id: payload.tenantId,
      callback_url: callbackUrl,
      status: payload.status,
      attempt: 1,
      max_retries: maxRetries,
    })
  );

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`, // ✅ Bearer Token
        },
        body,
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (response.ok) {
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "info",
            service: "callback-sender",
            event: "callback_success",
            job_id: payload.jobId,
            tenant_id: payload.tenantId,
            callback_url: callbackUrl,
            http_status: response.status,
            attempt,
          })
        );
        return; // ✅ Sucesso, sair
      }

      // HTTP error (400, 500, etc)
      const errorText = await response.text().catch(() => "");
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "warn",
          service: "callback-sender",
          event: "callback_http_error",
          job_id: payload.jobId,
          tenant_id: payload.tenantId,
          callback_url: callbackUrl,
          http_status: response.status,
          error_response: errorText.substring(0, 200),
          attempt,
          max_retries: maxRetries,
        })
      );
    } catch (error: any) {
      const errorType =
        error.name === "AbortError" ? "timeout" : "network_error";

      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "callback-sender",
          event: errorType,
          job_id: payload.jobId,
          tenant_id: payload.tenantId,
          callback_url: callbackUrl,
          error: error.message,
          attempt,
          max_retries: maxRetries,
        })
      );
    }

    // Retry com exponential backoff
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "callback-sender",
          event: "callback_retry_scheduled",
          job_id: payload.jobId,
          callback_url: callbackUrl,
          retry_in_ms: delay,
          next_attempt: attempt + 1,
        })
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // ❌ Todas as tentativas falharam
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "callback-sender",
      event: "callback_failed_all_retries",
      job_id: payload.jobId,
      tenant_id: payload.tenantId,
      callback_url: callbackUrl,
      max_retries: maxRetries,
    })
  );
}
