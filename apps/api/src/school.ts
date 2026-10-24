import { ApiError } from "@whizchool/shared/api";
import { prisma } from "./db";

/** The school's display name for emails and messages. */
export async function schoolName() {
  const school = await prisma.school.findUnique({ where: { id: "school" }, select: { name: true } });
  return school?.name ?? "Whizchool";
}

/** The academic year the school is working in; lists default to it. */
export async function currentYearId() {
  const school = await prisma.school.findUnique({ where: { id: "school" }, select: { currentYearId: true } });
  if (!school?.currentYearId) throw new ApiError(503, "not_configured", "The school has no current academic year yet.");
  return school.currentYearId;
}
