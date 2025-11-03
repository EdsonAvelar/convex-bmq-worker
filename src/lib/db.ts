// src/lib/db.ts
import { PrismaClient } from "@prisma/client";

/**
 * Singleton Prisma Client para conexão com o banco
 * Otimizado para uso em worker standalone
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Helper para fechar conexão gracefully
export async function disconnectPrisma() {
  await prisma.$disconnect();
  console.log("🔌 [Prisma] Desconectado do banco de dados");
}
