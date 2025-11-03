// src/lib/queue/webhookWorker.ts
import { Job } from "bullmq";
import { BaseWorker } from "./BaseWorker";

/**
 * Dados específicos para jobs de webhook
 */
export interface WebhookJobData {
  tenantId: number;
  integrationId: number;
  integrationName: string;
  negocioId?: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  timestamp?: string;
}

/**
 * Salva log de webhook via API interna (seguro - não acessa banco diretamente)
 */
async function saveWebhookLog(logData: {
  integrationId: number;
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
  const apiSecret = process.env.INTERNAL_API_SECRET;

  if (!apiUrl) {
    console.error("❌ [saveWebhookLog] APP_URL não configurada - log não será salvo");
    return;
  }

  if (!apiSecret) {
    console.error("❌ [saveWebhookLog] INTERNAL_API_SECRET não configurada - log não será salvo");
    return;
  }

  try {
    const response = await fetch(`${apiUrl}/api/internal/webhook-logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": apiSecret,
      },
      body: JSON.stringify(logData),
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `❌ [saveWebhookLog] API retornou erro ${response.status}: ${errorText}`
      );
      return;
    }

    console.log("✅ [saveWebhookLog] Log salvo via API com sucesso");
  } catch (error: any) {
    console.error(
      `❌ [saveWebhookLog] Erro ao chamar API:`,
      error.message
    );
  }
}

/**
 * Worker especializado para processar webhooks
 */
class WebhookWorker extends BaseWorker<WebhookJobData> {
  constructor() {
    super("webhooks", {
      concurrency: parseInt(process.env.WORKER_CONCURRENCY || "5"),
      limiter: {
        max: 5,
        duration: 1000,
      },
      lockDuration: parseInt(process.env.WORKER_LOCK_DURATION || "120000"),
      lockRenewTime: 30000,
      stalledInterval: 60000,
      maxStalledCount: 2,
    });
  }

  protected async processJob(job: Job<WebhookJobData>): Promise<any> {
    const {
      integrationId,
      integrationName,
      url,
      method,
      headers,
      body,
      tenantId,
      negocioId,
    } = job.data;

    const attemptNumber = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts || 3;

    console.log(`\n${"=".repeat(80)}`);
    console.log(`🔄 [WebhookWorker] TENTATIVA ${attemptNumber}/${maxAttempts}`);
    console.log(`📋 Job ID: ${job.id}`);
    console.log(`🏢 Tenant: ${tenantId}`);
    console.log(`🔗 Integração: ${integrationName} (ID: ${integrationId})`);
    console.log(`🎯 URL: ${url}`);
    console.log(`${"=".repeat(80)}\n`);

    const startTime = Date.now();
    let success = false;
    let statusCode: number | null = null;
    let responseBody: any = null;
    let errorMessage: string | null = null;

    try {
      console.log(`🚀 [WebhookWorker] Enviando requisição HTTP...`);

      const response = await fetch(url, {
        method: method || "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000), // 30s timeout
      });

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
        console.log(
          `✅ [WebhookWorker] SUCESSO na tentativa ${attemptNumber}/${maxAttempts}`
        );
        console.log(`📊 Status: ${statusCode}`);
        console.log(`⏱️ Tempo: ${duration}ms`);
      } else {
        console.log(
          `❌ [WebhookWorker] FALHA na tentativa ${attemptNumber}/${maxAttempts}`
        );
        console.log(`📊 Status: ${statusCode} (${response.statusText})`);
        console.log(`⏱️ Tempo: ${duration}ms`);
      }

      // Salvar log via API interna (seguro)
      await saveWebhookLog({
        integrationId,
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

      console.log(`💾 [WebhookWorker] Log enviado para API`);

      if (!success) {
        throw new Error(`HTTP ${statusCode}: ${response.statusText}`);
      }

      return { statusCode, success, duration };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      errorMessage = error.message;

      // Categorizar erro
      let errorCategory = "ERRO DESCONHECIDO";
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        errorCategory = "TIMEOUT";
      } else if (error.message?.includes("fetch failed")) {
        errorCategory = "FALHA DE CONEXÃO";
      } else if (error.message?.includes("ENOTFOUND")) {
        errorCategory = "DNS NÃO RESOLVIDO";
      } else if (error.message?.includes("ECONNREFUSED")) {
        errorCategory = "CONEXÃO RECUSADA";
      }

      console.log(`\n${"!".repeat(80)}`);
      console.log(
        `❌ [WebhookWorker] ERRO na tentativa ${attemptNumber}/${maxAttempts}`
      );
      console.log(`🏷️ Categoria: ${errorCategory}`);
      console.log(`💥 Mensagem: ${errorMessage}`);
      console.log(`⏱️ Tempo até erro: ${duration}ms`);

      if (attemptNumber < maxAttempts) {
        const nextDelay = Math.pow(2, attemptNumber) * 2000;
        console.log(
          `🔄 RETRY AGENDADO: Próxima tentativa em ${nextDelay}ms`
        );
      } else {
        console.log(`🚫 DESISTINDO: Última tentativa falhou`);
      }

      console.log(`${"!".repeat(80)}\n`);

      // Salvar erro via API interna (seguro)
      await saveWebhookLog({
        integrationId,
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

      console.log(`💾 [WebhookWorker] Log de erro enviado para API`);

      // Re-throw para BullMQ fazer retry
      throw error;
    }
  }
}

// Singleton
export let webhookWorker: WebhookWorker;

export function startWebhookWorker(): WebhookWorker {
  if (!webhookWorker) {
    webhookWorker = new WebhookWorker();
  }
  return webhookWorker;
}

export async function stopWebhookWorker(): Promise<void> {
  if (webhookWorker) {
    await webhookWorker.stop();
  }
}
