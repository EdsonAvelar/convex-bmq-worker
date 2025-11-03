// src/lib/queue/BaseQueue.ts
import { Queue, QueueOptions, JobsOptions } from "bullmq";
import { getRedisConnection } from "./connection";

/**
 * Interface base para dados de job
 */
export interface BaseJobData {
  tenantId: number;
  timestamp?: string;
  metadata?: Record<string, any>;
}

/**
 * Configuração padrão para todas as filas
 */
export const DEFAULT_QUEUE_OPTIONS: Partial<QueueOptions> = {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 86400 * 7,
    },
  },
};

/**
 * Classe base para todas as filas
 */
export abstract class BaseQueue<T extends BaseJobData> {
  protected queue: Queue<T>;
  protected queueName: string;

  constructor(queueName: string, options?: Partial<QueueOptions>) {
    this.queueName = queueName;
    this.queue = new Queue<T>(queueName, {
      ...DEFAULT_QUEUE_OPTIONS,
      ...options,
    });

    this.setupEventListeners();
  }

  async addJob(
    jobName: string,
    data: T,
    options?: JobsOptions
  ): Promise<string> {
    if (!data.tenantId) {
      throw new Error(`tenantId é obrigatório para todos os jobs`);
    }

    if (!data.timestamp) {
      data.timestamp = new Date().toISOString();
    }

    const job = await this.queue.add(jobName, data, {
      ...options,
      jobId: options?.jobId || this.generateJobId(data.tenantId, jobName),
    });

    console.log(
      `📬 [${this.queueName}] Job enfileirado: ${job.id} (tenant=${data.tenantId})`
    );

    return job.id;
  }

  protected generateJobId(tenantId: number, jobName: string): string {
    return `tenant-${tenantId}-${jobName}-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
  }

  async getStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  private setupEventListeners() {
    this.queue.on("error", (err) => {
      console.error(`❌ [${this.queueName}] Erro na fila:`, err.message);
    });
  }

  async close() {
    await this.queue.close();
    console.log(`🔌 [${this.queueName}] Fila fechada`);
  }
}
