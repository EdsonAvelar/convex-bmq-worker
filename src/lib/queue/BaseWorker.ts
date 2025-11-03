// src/lib/queue/BaseWorker.ts
import { Worker, Job, WorkerOptions } from "bullmq";
import {
  getRedisSingleton,
  createBlockingRedisClient,
  waitForReady,
} from "./connection";
import { BaseJobData } from "./BaseQueue";
import IORedis from "ioredis";

/**
 * Configuração padrão robusta para todos os workers
 * ✅ Baseada nas melhores práticas de resiliência
 */
export const DEFAULT_WORKER_OPTIONS: Partial<WorkerOptions> = {
  concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "10", 10),
  limiter: {
    max: 50,
    duration: 1000,
  },
  lockDuration: 60000, // 60s - tempo máximo para um job ser processado
  stalledInterval: 30000, // 30s - intervalo para detectar jobs travados
  maxStalledCount: 2, // Máximo de jobs travados antes de falhar
  lockRenewTime: 15000, // 15s - renovar lock a cada 15s
};

/**
 * Classe base para todos os workers com logging estruturado e resiliência
 * ✅ ATUALIZADA: Usa singleton + blocking client para resolver "Command timed out"
 */
export abstract class BaseWorker<T extends BaseJobData> {
  protected worker: Worker<T>;
  protected workerName: string;
  private isRunning: boolean = false;
  private normalClient: IORedis;
  private blockingClient: IORedis;

  constructor(queueName: string, options?: Partial<WorkerOptions>) {
    this.workerName = queueName;

    // ✅ Usar singleton para operações normais + blocking client dedicado
    this.normalClient = getRedisSingleton();
    this.blockingClient = createBlockingRedisClient();

    // Log de inicialização estruturado
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "worker",
        event: "initializing",
        queue: queueName,
        options: {
          concurrency:
            options?.concurrency || DEFAULT_WORKER_OPTIONS.concurrency,
          lockDuration:
            options?.lockDuration || DEFAULT_WORKER_OPTIONS.lockDuration,
          limiter: options?.limiter || DEFAULT_WORKER_OPTIONS.limiter,
        },
        redis_clients: {
          normal_client: "singleton",
          blocking_client: "created_with_commandTimeout_0",
        },
      })
    );

    // ✅ Opcional: Aguardar ready explícito antes de processar
    waitForReady(this.normalClient).catch((err) => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "worker",
          event: "normal_client_ready_failed",
          queue: queueName,
          error: err.message,
        })
      );
    });

    waitForReady(this.blockingClient).catch((err) => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "worker",
          event: "blocking_client_ready_failed",
          queue: queueName,
          error: err.message,
        })
      );
    });

    // ✅ Usar singleton para connection E blocking client dedicado nas OPTIONS
    this.worker = new Worker<T>(
      queueName,
      async (job: Job<T>) => this.processWithLogging(job),
      {
        ...DEFAULT_WORKER_OPTIONS,
        ...options,
        connection: this.normalClient, // ✅ Singleton
        // @ts-ignore - blockingConnection pode não estar tipado em todas as versões
        blockingConnection: this.blockingClient, // ✅ CRÍTICO: passar nas options
      }
    );

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "worker",
        event: "blocking_connection_configured",
        queue: queueName,
        method: "worker_options",
      })
    );

    this.setupEventListeners();
    this.isRunning = true;

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "worker",
        event: "started",
        queue: this.workerName,
      })
    );
  }

  /**
   * Método abstrato que deve ser implementado
   */
  protected abstract processJob(job: Job<T>): Promise<any>;

  /**
   * Wrapper com logging estruturado e métricas
   */
  private async processWithLogging(job: Job<T>): Promise<any> {
    const startTime = Date.now();
    const { tenantId } = job.data;
    const jobId = job.id || "unknown";

    // Log de início estruturado
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "worker",
        event: "job_started",
        queue: this.workerName,
        job_id: jobId,
        tenant_id: tenantId,
        attempt: job.attemptsMade + 1,
        max_attempts: job.opts.attempts || 3,
      })
    );

    try {
      if (!tenantId) {
        throw new Error("tenantId ausente no job data");
      }

      const result = await this.processJob(job);
      const duration = Date.now() - startTime;

      // Log de sucesso estruturado
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "worker",
          event: "job_completed",
          queue: this.workerName,
          job_id: jobId,
          tenant_id: tenantId,
          duration_ms: duration,
          attempt: job.attemptsMade + 1,
        })
      );

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      // Log de erro estruturado
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "worker",
          event: "job_failed",
          queue: this.workerName,
          job_id: jobId,
          tenant_id: tenantId,
          duration_ms: duration,
          attempt: job.attemptsMade + 1,
          error: error.message,
          error_stack: error.stack?.split("\n").slice(0, 5).join(" | "),
        })
      );

      throw error;
    }
  }

  /**
   * Event listeners com logs estruturados
   */
  private setupEventListeners() {
    this.worker.on("completed", (job) => {
      if (!job) return;

      // Calcular duração
      const duration =
        job.finishedOn && job.processedOn
          ? job.finishedOn - job.processedOn
          : 0;

      // Registrar métrica de sucesso
      try {
        const { recordJobSuccess } = require("../../../index");
        if (recordJobSuccess && duration > 0) {
          recordJobSuccess(duration);
        }
      } catch (e) {
        // Silencioso se index não estiver disponível
      }

      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "worker",
          event: "job_success",
          queue: this.workerName,
          job_id: job.id,
          tenant_id: job.data.tenantId,
          attempt: job.attemptsMade + 1,
          total_attempts: job.opts.attempts || 3,
          duration_ms: duration,
        })
      );
    });

    this.worker.on("failed", (job, err) => {
      if (!job) return;

      // Registrar métrica de falha
      try {
        const { recordJobFailure } = require("../../../index");
        if (recordJobFailure) {
          recordJobFailure(err.message);
        }
      } catch (e) {
        // Silencioso se index não estiver disponível
      }
      if (!job) return;

      const attemptMsg = `${job.attemptsMade + 1}/${job.opts.attempts || 3}`;
      const willRetry = job.attemptsMade + 1 < (job.opts.attempts || 3);

      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "worker",
          event: willRetry ? "job_retry" : "job_dead",
          queue: this.workerName,
          job_id: job.id,
          tenant_id: job.data.tenantId,
          attempt: job.attemptsMade + 1,
          max_attempts: job.opts.attempts || 3,
          will_retry: willRetry,
          error: err.message,
          error_name: err.name,
        })
      );

      if (willRetry) {
        const nextAttempt = job.attemptsMade + 2;
        const delay = Math.pow(2, job.attemptsMade + 1) * 2000;
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "info",
            service: "worker",
            event: "retry_scheduled",
            queue: this.workerName,
            job_id: job.id,
            next_attempt: nextAttempt,
            delay_ms: delay,
          })
        );
      }
    });

    this.worker.on("error", (err: any) => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "worker",
          event: "worker_error",
          queue: this.workerName,
          error: err.message,
          error_name: err.name,
          command: err.command || null,
        })
      );
    });

    this.worker.on("stalled", (jobId) => {
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "warn",
          service: "worker",
          event: "job_stalled",
          queue: this.workerName,
          job_id: jobId,
        })
      );
    });

    this.worker.on("drained", () => {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "worker",
          event: "queue_drained",
          queue: this.workerName,
        })
      );
    });
  }

  /**
   * ✅ ATUALIZADO: Para o worker gracefully e fecha APENAS blocking client
   * Singleton não é fechado aqui pois pode ser usado por outros componentes
   */
  async stop(): Promise<void> {
    if (this.isRunning) {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "worker",
          event: "stopping",
          queue: this.workerName,
        })
      );

      // 1. Parar worker primeiro
      await this.worker.close();

      // 2. Fechar APENAS blocking client (singleton é compartilhado)
      try {
        await this.blockingClient.quit();
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "info",
            service: "worker",
            event: "blocking_client_closed",
            queue: this.workerName,
          })
        );
      } catch (error: any) {
        console.warn(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "warn",
            service: "worker",
            event: "blocking_client_close_error",
            queue: this.workerName,
            error: error.message,
          })
        );
      }

      this.isRunning = false;

      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "worker",
          event: "stopped",
          queue: this.workerName,
        })
      );
    }
  }

  /**
   * Verifica se worker está rodando
   */
  isActive(): boolean {
    return this.isRunning && !this.worker.closing;
  }

  /**
   * Verifica se está pausado
   */
  async isPaused(): Promise<boolean> {
    return this.worker.isPaused();
  }

  /**
   * Aguarda worker ficar pronto
   */
  async waitUntilReady(): Promise<void> {
    await this.worker.waitUntilReady();
  }

  /**
   * Getter para o worker (para compatibilidade)
   */
  getWorker(): Worker<T> {
    return this.worker;
  }
}
