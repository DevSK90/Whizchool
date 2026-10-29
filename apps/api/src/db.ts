import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { config } from "./config";

export const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: config.DATABASE_URL,
    // Postgres JIT-compiles queries its planner thinks are big. For this app's short queries the
    // compiling costs more than it saves (~100 ms on exam progress), so it's off for our connections.
    options: "-c jit=off",
  }),
});

export type Db = typeof prisma;
