-- CreateEnum
CREATE TYPE "StaffType" AS ENUM ('academic', 'non_academic');

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "address" TEXT,
ADD COLUMN     "dob" DATE,
ADD COLUMN     "emergencyName" TEXT,
ADD COLUMN     "emergencyPhone" TEXT,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "joinedOn" DATE,
ADD COLUMN     "leaveReason" TEXT,
ADD COLUMN     "leftOn" DATE,
ADD COLUMN     "nic" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "qualifications" TEXT,
ADD COLUMN     "staffType" "StaffType" NOT NULL DEFAULT 'non_academic',
ALTER COLUMN "email" DROP NOT NULL;


-- Existing staff: teachers and school leaders are academic, everyone else keeps the default.
UPDATE "Staff" SET "staffType" = 'academic' WHERE "designation" ~* '^(teacher|principal|deputy principal|vice principal)';

-- Built-in roles in existing databases get the new permissions (new schools get them from their seed).
UPDATE "Role" SET "permissions" = array_append("permissions", 'staff.view')
  WHERE "name" IN ('Admin', 'Principal') AND NOT 'staff.view' = ANY("permissions");
UPDATE "Role" SET "permissions" = array_append("permissions", 'staff.create')
  WHERE "name" IN ('Admin', 'Principal') AND NOT 'staff.create' = ANY("permissions");
UPDATE "Role" SET "permissions" = array_append("permissions", 'staff.edit')
  WHERE "name" IN ('Admin', 'Principal') AND NOT 'staff.edit' = ANY("permissions");
