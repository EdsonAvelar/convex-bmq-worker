// src/lib/queue/webhookWorker.ts
import { Job } from "bullmq";
import { BaseWorker } from "./BaseWorker";
import { prisma } from "../db";

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

      // Salvar log no banco
      await prisma.webhookLog.create({
        data: {
          integrationId,
          negocioId: negocioId || null,
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
        },
      });

      console.log(`💾 [WebhookWorker] Log salvo no banco`);

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

      // Salvar erro no banco
      await prisma.webhookLog.create({
        data: {
          integrationId,
          negocioId: negocioId || null,
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
        },
      });

      console.log(`💾 [WebhookWorker] Log de erro salvo no banco`);

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
