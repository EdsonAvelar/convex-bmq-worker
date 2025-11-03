#!/usr/bin/env tsx
/**
 * Script para limpar a fila (remover todos os jobs)
 *
 * Uso:
 *   npm run queue:clean         # Limpa completed e failed
 *   npm run queue:clean --all   # Limpa TUDO (incluindo waiting)
 */

import { Queue } from "bullmq";
import { getRedisSingleton } from "../src/lib/queue/connection";

async function cleanQueue(cleanAll: boolean = false) {
  const redis = getRedisSingleton();

  const queue = new Queue("webhooks", {
    connection: redis,
  });

  console.log("🧹 Limpando fila: webhooks\n");

  try {
    if (cleanAll) {
      console.log(
        "⚠️  ATENÇÃO: Limpando TODOS os jobs (incluindo waiting)...\n"
      );

      await queue.drain(); // Remove waiting e delayed
      console.log("✅ Jobs waiting removidos");

      await queue.clean(0, 0, "completed");
      console.log("✅ Jobs completed removidos");

      await queue.clean(0, 0, "failed");
      console.log("✅ Jobs failed removidos");

      await queue.clean(0, 0, "active");
      console.log("✅ Jobs active removidos");
    } else {
      console.log("🧹 Limpando apenas jobs completed e failed...\n");

      const completedCount = await queue.clean(0, 0, "completed");
      console.log(`✅ ${completedCount.length} jobs completed removidos`);

      const failedCount = await queue.clean(0, 0, "failed");
      console.log(`✅ ${failedCount.length} jobs failed removidos`);
    }

    console.log("\n✨ Limpeza concluída!");

    const counts = await queue.getJobCounts();
    console.log("\n📊 Status atual da fila:");
    console.log(`   Waiting: ${counts.waiting || 0}`);
    console.log(`   Active: ${counts.active || 0}`);
    console.log(`   Completed: ${counts.completed || 0}`);
    console.log(`   Failed: ${counts.failed || 0}`);
  } catch (error: any) {
    console.error("❌ Erro ao limpar fila:", error.message);
  }

  await queue.close();
  await redis.quit();
  process.exit(0);
}

const cleanAll = process.argv.includes("--all");

cleanQueue(cleanAll).catch((error) => {
  console.error("❌ Erro:", error);
  process.exit(1);
});
