import { describe, expect, it } from "vitest";
import { checkFile, MAX_UPLOAD_BYTES } from "@/lib/uploads";

const file = (type: string, size = 1000) => ({ type, size, name: "x" }) as File;

describe("checkFile", () => {
  it("allows PDFs and images for documents, images only for photos", () => {
    expect(checkFile(file("application/pdf"), "application-document")).toBeNull();
    expect(checkFile(file("image/webp"), "student-document")).toBeNull();
    expect(checkFile(file("application/pdf"), "student-photo")).toBe("badType");
    expect(checkFile(file("image/gif"), "application-document")).toBe("badType");
  });

  it("enforces the 5 MB limit", () => {
    expect(checkFile(file("image/png", MAX_UPLOAD_BYTES), "student-photo")).toBeNull();
    expect(checkFile(file("image/png", MAX_UPLOAD_BYTES + 1), "student-photo")).toBe("tooLarge");
  });
});
