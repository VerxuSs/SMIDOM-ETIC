import { PrismaClient } from "@prisma/client";

// Évite de recréer une instance de PrismaClient à chaque hot-reload en
// développement (comportement recommandé par Prisma avec Next.js).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
