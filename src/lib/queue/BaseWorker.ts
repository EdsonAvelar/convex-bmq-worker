// src/lib/queue/BaseWorker.ts
import { Worker, Job, WorkerOptions } from "bullmq";
import { getRedisConnection } from "./connection";
import { BaseJobData } from "./BaseQueue";

/**
 * Configuração padrão para todos os workers
 */
export const DEFAULT_WORKER_OPTIONS: Partial<WorkerOptions> = {
  connection: getRedisConnection(),
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 1000,
  },
};

/**
 * Classe base para todos os workers
 */
export abstract class BaseWorker<T extends BaseJobData> {
  protected worker: Worker<T>;
  protected workerName: string;
  private isRunning: boolean = false;

  constructor(queueName: string, options?: Partial<WorkerOptions>) {
    this.workerName = queueName;

    this.worker = new Worker<T>(
      queueName,
      async (job: Job<T>) => this.processWithLogging(job),
      {
        ...DEFAULT_WORKER_OPTIONS,
        ...options,
      }
    );

    this.setupEventListeners();
    this.isRunning = true;

    console.log(`🚀 [Worker:${this.workerName}] Iniciado`);
  }

  /**
   * Método abstrato que deve ser implementado
   */
  protected abstract processJob(job: Job<T>): Promise<any>;

  /**
   * Wrapper com logging
   */
  private async processWithLogging(job: Job<T>): Promise<any> {
    const startTime = Date.now();
    const { tenantId } = job.data;

    console.log(
      `🔄 [Worker:${this.workerName}] Processando job=${
        job.id
      }, tenant=${tenantId}, tentativa=${job.attemptsMade + 1}`
    );

    try {
      if (!tenantId) {
        throw new Error("tenantId ausente no job data");
      }

      const result = await this.processJob(job);

      const duration = Date.now() - startTime;

      console.log(
        `✅ [Worker:${this.workerName}] Job completado: ${job.id} (${duration}ms, tenant=${tenantId})`
      );

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      console.error(
        `❌ [Worker:${this.workerName}] Job falhou: ${job.id} (${duration}ms, tenant=${tenantId})`,
        error.message
      );

      throw error;
    }
  }

  /**
   * Event listeners
   */
  private setupEventListeners() {
    this.worker.on("completed", (job) => {
      if (!job) return;
      const attemptInfo =
        job.attemptsMade > 0
          ? ` (após ${job.attemptsMade + 1} tentativa(s))`
          : "";

      console.log(
        `✅ [Worker:${this.workerName}] Sucesso: ${job.id}${attemptInfo}`
      );
    });

    this.worker.on("failed", (job, err) => {
      if (!job) return;

      const attemptMsg = `${job.attemptsMade + 1}/${job.opts.attempts || 3}`;
      const willRetry = job.attemptsMade + 1 < (job.opts.attempts || 3);

      console.log(`\n${"═".repeat(80)}`);
      console.error(`❌ [Worker:${this.workerName}] FAILED: Job ${job.id}`);
      console.error(`📊 Tentativas: ${attemptMsg}`);
      console.error(`💥 Erro: ${err.message}`);

      if (willRetry) {
        const nextAttempt = job.attemptsMade + 2;
        const delay = Math.pow(2, job.attemptsMade + 1) * 2000;
        console.log(
          `🔄 RETRY em ${delay}ms (tentativa ${nextAttempt}/${
            job.opts.attempts || 3
          })`
        );
      } else {
        console.error(`🚫 FALHA PERMANENTE após ${job.opts.attempts || 3} tentativas`);
      }
      console.log(`${"═".repeat(80)}\n`);
    });

    this.worker.on("error", (err) => {
      console.error(
        `❌ [Worker:${this.workerName}] Erro no worker:`,
        err.message
      );
    });

    this.worker.on("stalled", (jobId) => {
      console.warn(
        `⚠️ [Worker:${this.workerName}] Job travado detectado: ${jobId}`
      );
    });
  }

  /**
   * Para o worker gracefully
   */
  async stop(): Promise<void> {
    if (this.isRunning) {
      console.log(`🛑 [Worker:${this.workerName}] Parando...`);
      await this.worker.close();
      this.isRunning = false;
      console.log(`✅ [Worker:${this.workerName}] Parado`);
    }
  }

  /**
   * Verifica se worker está rodando
   */
  async isActive(): Promise<boolean> {
    return !this.worker.closing;
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
}
