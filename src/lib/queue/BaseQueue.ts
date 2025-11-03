// src/lib/queue/BaseQueue.ts
import { Queue, QueueOptions, JobsOptions } from "bullmq";
import { getRedisSingleton } from "./connection";

/**
 * Interface base para dados de job
 */
export interface BaseJobData {
  tenantId: number;
  timestamp?: string;
  metadata?: Record<string, any>;
}

/**
 * Configuração padrão robusta para todas as filas
 * ✅ ATUALIZADA: Usa singleton para consistência
 */
export const DEFAULT_QUEUE_OPTIONS: Partial<QueueOptions> = {
  // connection será definida na construção da Queue individual
  defaultJobOptions: {
    attempts: 5, // ✅ 5 tentativas (mais robusto)
    backoff: {
      type: "exponential",
      delay: 2000, // ✅ Backoff exponencial começando em 2s
    },
    removeOnComplete: {
      age: 3600, // Remove jobs completos após 1 hora
      count: 1000, // Manter no máximo 1000 jobs completos
    },
    removeOnFail: {
      age: 86400, // Remove jobs falhados após 24 horas
      count: 5000, // Manter no máximo 5000 jobs falhados
    },
    // ✅ Prevenção de jobs órfãos
    delay: 0,
    priority: 0,
  },
};

/**
 * Classe base para todas as filas com logging estruturado
 */
export abstract class BaseQueue<T extends BaseJobData> {
  protected queue: Queue<T, any, string>;
  protected queueName: string;

  constructor(queueName: string, options?: Partial<QueueOptions>) {
    this.queueName = queueName;

    // Log de inicialização estruturado
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "queue",
        event: "initializing",
        queue: queueName,
      })
    );

    this.queue = new Queue<T, any, string>(queueName, {
      ...DEFAULT_QUEUE_OPTIONS,
      ...options,
      connection: getRedisSingleton(), // ✅ Usar singleton
    });

    this.setupEventListeners();

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "queue",
        event: "initialized",
        queue: queueName,
      })
    );
  }

  async addJob(
    jobName: string,
    data: T,
    options?: JobsOptions
  ): Promise<string | undefined> {
    if (!data.tenantId) {
      throw new Error(`tenantId é obrigatório para todos os jobs`);
    }

    if (!data.timestamp) {
      data.timestamp = new Date().toISOString();
    }

    const jobId = options?.jobId || this.generateJobId(data.tenantId, jobName);

    const job = await (this.queue as any).add(jobName, data, {
      ...options,
      jobId,
    });

    // Log estruturado de job enfileirado
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "queue",
        event: "job_added",
        queue: this.queueName,
        job_id: job.id,
        job_name: jobName,
        tenant_id: data.tenantId,
        attempts: options?.attempts || 5,
        delay: options?.delay || 0,
        priority: options?.priority || 0,
      })
    );

    return job.id;
  }

  protected generateJobId(tenantId: number, jobName: string): string {
    return `tenant-${tenantId}-${jobName}-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
  }

  async getStats() {
    try {
      const [waiting, active, completed, failed, delayed, paused] =
        await Promise.all([
          this.queue.getWaitingCount(),
          this.queue.getActiveCount(),
          this.queue.getCompletedCount(),
          this.queue.getFailedCount(),
          this.queue.getDelayedCount(),
          this.queue.isPaused(),
        ]);

      const stats = { waiting, active, completed, failed, delayed, paused };

      // Log de estatísticas estruturado
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "queue",
          event: "stats_collected",
          queue: this.queueName,
          stats,
        })
      );

      return stats;
    } catch (error: any) {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "queue",
          event: "stats_error",
          queue: this.queueName,
          error: error.message,
        })
      );
      throw error;
    }
  }

  /**
   * Limpa jobs antigos (manutenção)
   */
  async cleanup(maxAge: number = 86400000): Promise<void> {
    try {
      const cleaned = await this.queue.clean(maxAge, 1000, "completed");
      const failedCleaned = await this.queue.clean(maxAge * 7, 1000, "failed"); // Jobs falhados por mais tempo

      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "queue",
          event: "cleanup_completed",
          queue: this.queueName,
          completed_cleaned: cleaned.length,
          failed_cleaned: failedCleaned.length,
          max_age_ms: maxAge,
        })
      );
    } catch (error: any) {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "queue",
          event: "cleanup_error",
          queue: this.queueName,
          error: error.message,
        })
      );
    }
  }

  private setupEventListeners() {
    this.queue.on("error", (err: any) => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "queue",
          event: "queue_error",
          queue: this.queueName,
          error: err.message,
          error_name: err.name,
        })
      );
    });

    this.queue.on("waiting", (job) => {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "debug",
          service: "queue",
          event: "job_waiting",
          queue: this.queueName,
          job_id: job.id,
          tenant_id: job.data?.tenantId,
        })
      );
    });
  }

  async close() {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "queue",
        event: "closing",
        queue: this.queueName,
      })
    );

    await this.queue.close();

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "queue",
        event: "closed",
        queue: this.queueName,
      })
    );
  }

  /**
   * Getter para a queue (para compatibilidade)
   */
  getQueue(): Queue<T, any, string> {
    return this.queue;
  }
}
