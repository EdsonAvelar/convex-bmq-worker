// src/lib/types.ts

/**
 * Payload padronizado para enfileirar jobs
 * Suporta múltiplos tipos: webhook, email, SMS, notificações
 */
export interface QueueJobPayload {
  // Identificação
  jobType: "webhook" | "email" | "sms" | "notification";
  tenantId: number;
  integrationId?: number; // Opcional (não existe para emails)
  integrationName?: string;
  negocioId?: number; // Opcional (contexto do job)

  // Destino do job (onde fazer requisição)
  destination: {
    url: string; // URL para onde enviar (webhook, API email, etc)
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    headers?: Record<string, string>;
    body?: any; // Payload para o destino
    timeout?: number; // Opcional, padrão 30000ms
  };

  // Callback (notificação de resultado)
  callback: {
    url: string; // URL completa: https://app.com/api/queue/callback
    secret?: string; // Opcional: HMAC específico por request
  };

  // Configurações opcionais
  options?: {
    priority?: "low" | "normal" | "high"; // Prioridade na fila
    retries?: number; // Padrão: 3
    backoff?: number; // Delay inicial em ms (padrão: 2000)
  };

  // Metadados para debugging/tracking
  metadata?: Record<string, any>;
}

/**
 * Payload enviado pelo worker após processar o job (callback)
 */
export interface WorkerCallbackPayload {
  // Identificação
  jobId: string;
  jobType: "webhook" | "email" | "sms" | "notification";
  tenantId: number;
  integrationId?: number;
  negocioId?: number;

  // Status da execução
  status: "success" | "failed" | "timeout" | "retrying";
  success: boolean;

  // Resposta do destino
  destination: {
    url: string;
    method: string;
    statusCode: number; // HTTP status (200, 400, 500, etc)
    headers?: Record<string, string>;
    body?: any; // Resposta recebida
    duration: number; // Tempo em ms
  };

  // Erro (se houver)
  error?: {
    message: string;
    code?: string; // ETIMEDOUT, ECONNREFUSED, etc
    isRetryable: boolean; // Se vai retentar
    stack?: string; // Stack trace (opcional, só em dev)
  };

  // Informações de execução
  execution: {
    attempt: number; // Tentativa atual (1 a maxAttempts)
    maxAttempts: number;
    startedAt: string; // ISO 8601
    completedAt: string; // ISO 8601
    duration: number; // Duração total em ms
    nextRetryAt?: string; // Se status === "retrying"
  };

  // Echo dos metadados originais
  metadata?: Record<string, any>;
}

/**
 * Resposta ao enfileirar um job
 */
export interface QueueEnqueueResponse {
  success: boolean;
  jobId: string; // ID único do BullMQ
  message?: string;
  error?: string;
}
