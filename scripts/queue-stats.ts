#!/usr/bin/env tsx
/**
 * Script para monitorar estatísticas da fila em tempo real
 *
 * Uso:
 *   npm run queue:stats
 *   npm run queue:stats --watch  # Atualiza a cada 2s
 */

import { Queue } from "bullmq";
import { getRedisSingleton } from "../src/lib/queue/connection";

async function getQueueStats(watch: boolean = false) {
  const redis = getRedisSingleton();

  const queue = new Queue("webhooks", {
    connection: redis,
  });

  const showStats = async () => {
    console.clear();
    console.log("📊 Estatísticas da Fila: webhooks\n");
    console.log("═".repeat(60));

    try {
      const counts = await queue.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed",
        "paused"
      );

      console.log(`\n⏳ Aguardando:  ${counts.waiting || 0}`);
      console.log(`🔄 Processando: ${counts.active || 0}`);
      console.log(`✅ Completos:   ${counts.completed || 0}`);
      console.log(`❌ Falhados:    ${counts.failed || 0}`);
      console.log(`⏰ Atrasados:   ${counts.delayed || 0}`);
      console.log(`⏸️  Pausados:    ${counts.paused || 0}`);

      // Workers ativos
      const workers = await queue.getWorkers();
      console.log(`\n👷 Workers ativos: ${workers.length}`);

      // Jobs recentes
      console.log("\n" + "─".repeat(60));
      console.log("📋 Últimos 5 jobs processados:\n");

      const completed = await queue.getCompleted(0, 4);
      if (completed.length > 0) {
        for (const job of completed) {
          const duration =
            job.finishedOn && job.processedOn
              ? job.finishedOn - job.processedOn
              : 0;
          console.log(
            `  ✅ ${job.id} | Tenant ${job.data.tenantId} | ${duration}ms`
          );
        }
      } else {
        console.log("  (nenhum job processado ainda)");
      }

      // Jobs falhados recentes
      const failed = await queue.getFailed(0, 2);
      if (failed.length > 0) {
        console.log("\n❌ Últimos jobs falhados:\n");
        for (const job of failed) {
          console.log(
            `  ❌ ${job.id} | Tenant ${
              job.data.tenantId
            } | ${job.failedReason?.substring(0, 50)}...`
          );
        }
      }

      console.log("\n" + "═".repeat(60));
      console.log(`\n⏰ Atualizado: ${new Date().toLocaleTimeString("pt-BR")}`);

      if (watch) {
        console.log("\n💡 Pressione Ctrl+C para sair\n");
      }
    } catch (error: any) {
      console.error("\n❌ Erro ao obter estatísticas:", error.message);
    }
  };

  if (watch) {
    // Modo watch: atualiza a cada 2s
    await showStats();
    setInterval(showStats, 2000);
  } else {
    // Modo único
    await showStats();
    await queue.close();
    await redis.quit();
    process.exit(0);
  }
}

// Parse argumentos
const watch = process.argv.includes("--watch");

getQueueStats(watch).catch((error) => {
  console.error("❌ Erro:", error);
  process.exit(1);
});
