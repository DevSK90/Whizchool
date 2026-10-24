// `npm run db:seed`: wipes the database and loads the demo school.
import { prisma } from "../src/db";
import { seedDemoSchool } from "../src/seed/demo-school";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data into a production database.");
  process.exit(1);
}

seedDemoSchool(prisma)
  .then((summary) => console.log(summary))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
