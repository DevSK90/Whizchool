/** Tests own this database: it is dropped and re-created from the seeded template on every run. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://whizchool:whizchool@localhost:5433/whizchool_test";

export const ORIGIN = "http://localhost:3000";
