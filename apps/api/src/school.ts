import { prisma } from "./db";

/** The school's display name for emails and messages. */
export async function schoolName() {
  const school = await prisma.school.findUnique({ where: { id: "school" }, select: { name: true } });
  return school?.name ?? "Whizchool";
}
