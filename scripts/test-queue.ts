#!/usr/bin/env tsx
/**
 * Script de teste para adicionar jobs na fila de webhooks
 *
 * Uso:
 *   npm run test:queue           # Adiciona 1 job de teste
 *   npm run test:queue 5         # Adiciona 5 jobs
 *   npm run test:queue 10 --fast # Adiciona 10 jobs rapidamente
 */

import { Queue } from "bullmq";
import { getRedisSingleton } from "../src/lib/queue/connection";

interface WebhookJobData {
  tenantId: number;
  webhookUrl: string;
  payload: Record<string, any>;
  headers?: Record<string, string>;
  timestamp?: string;
  metadata?: Record<string, any>;
}

async function addTestJobs(count: number = 1, fast: boolean = false) {
  const redis = getRedisSingleton();

  console.log("🔌 Conectando ao Redis...");

  const queue = new Queue<WebhookJobData>("webhooks", {
    connection: redis,
  });

  console.log(`\n📦 Adicionando ${count} job(s) de teste...\n`);

  const urls = [
    "https://webhook.site/unique-id-1",
    "https://httpbin.org/post",
    "https://postman-echo.com/post",
    "https://webhook.site/unique-id-2",
    "https://requestcatcher.com/test",
  ];

  const events = [
    "user.created",
    "order.completed",
    "payment.received",
    "invoice.generated",
    "subscription.renewed",
  ];

  for (let i = 0; i < count; i++) {
    const tenantId = Math.floor(Math.random() * 10) + 1;
    const webhookUrl = urls[i % urls.length];
    const event = events[i % events.length];

    const jobData: WebhookJobData = {
      tenantId,
      webhookUrl,
      payload: {
        event: event,
        data: {
          id: `test-${Date.now()}-${i}`,
          timestamp: new Date().toISOString(),
          amount: Math.floor(Math.random() * 1000) + 100,
          status: "success",
          user: {
            id: Math.floor(Math.random() * 1000),
            email: `user${tenantId}@example.com`,
          },
        },
      },
      headers: {
        "X-Webhook-Signature": "test-signature-123",
        "X-Tenant-ID": String(tenantId),
      },
      timestamp: new Date().toISOString(),
      metadata: {
        source: "test-script",
        version: "1.0.0",
      },
    };

    const job = await queue.add("webhook", jobData, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
    });

    console.log(
      `✅ Job ${i + 1}/${count} adicionado: ${
        job.id
      } | Tenant ${tenantId} | ${event} → ${webhookUrl}`
    );

    if (!fast && i < count - 1) {
      // Delay entre jobs para simular produção
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(`\n✨ ${count} job(s) adicionado(s) com sucesso!\n`);
  console.log("📊 Para monitorar o processamento:");
  console.log("   docker-compose logs -f worker\n");
  console.log("🔍 Para ver o status da fila:");
  console.log("   npm run queue:stats\n");

  await queue.close();
  await redis.quit();
  process.exit(0);
}

// Parse argumentos
const args = process.argv.slice(2);
const count = parseInt(args[0]) || 1;
const fast = args.includes("--fast");

addTestJobs(count, fast).catch((error) => {
  console.error("❌ Erro ao adicionar jobs:", error);
  process.exit(1);
});
