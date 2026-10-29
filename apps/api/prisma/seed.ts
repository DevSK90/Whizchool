// `npm run db:seed`: wipes the database and loads the demo school.
// SEED_SIZE=large loads a ~1,600-student version instead (for speed checks; see `npm run perf`).
import { prisma } from "../src/db";
import { seedDemoSchool } from "../src/seed/demo-school";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data into a production database.");
  process.exit(1);
}

seedDemoSchool(prisma, process.env.SEED_SIZE === "large" ? "large" : "standard")
  .then((summary) => console.log(summary))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
