import sharp from "sharp";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { resetRateLimits } from "../src/http/rate-limit";
import { store } from "../src/storage";
import { app, client, signIn, unique } from "./helpers";
import { ORIGIN } from "./env";

beforeEach(() => resetRateLimits());

/** A JPEG as a phone camera makes it: large, with EXIF metadata including a GPS position. */
async function cameraPhoto() {
  return sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#4a7" } })
    .jpeg()
    .withExif({ IFD0: { Make: "PhoneCam", Model: "X1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "7/1 17/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "80/1 38/1 0/1" } })
    .toBuffer();
}

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const newStudent = (over: Record<string, unknown> = {}) => ({
  firstName: "Test",
  lastName: `Student${unique()}`,
  gender: "F",
  dob: "2015-05-05",
  classId: "cls_2026_5a",
  address: "1 Main Street, Kandy",
  electiveSubjectIds: [],
  discountIds: [],
  guardian: { name: "Mrs. Test Parent", relationship: "Mother", phone: `07${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, email: "" },
  ...over,
});

describe("uploads", () => {
  it("re-encodes photos: EXIF (including GPS) removed and size capped", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const original = await cameraPhoto();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const res = await admin.post("/api/v1/uploads").field("purpose", "student-photo").attach("file", original, "IMG_0001.jpeg");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mimeType: "image/jpeg", name: "IMG_0001.jpeg" });
    const saved = await prisma.fileObject.findUniqueOrThrow({ where: { id: res.body.id } });
    const meta = await sharp(await store.get(saved.key)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(Math.max(meta.width!, meta.height!)).toBe(640);
  });

  it("judges files by their bytes, not their names", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const fake = await admin.post("/api/v1/uploads").field("purpose", "student-document").attach("file", Buffer.from("just text"), "report.pdf");
    expect(fake.status).toBe(415);
    const pdfAsPhoto = await admin.post("/api/v1/uploads").field("purpose", "student-photo").attach("file", PDF, "photo.jpg");
    expect(pdfAsPhoto.status).toBe(415);
    const pdf = await admin.post("/api/v1/uploads").field("purpose", "student-document").attach("file", PDF, "../../etc/report.pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.body).toMatchObject({ mimeType: "application/pdf", name: "report.pdf" });
  });

  it("serves files only through valid, unexpired signed links", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const { body } = await admin.post("/api/v1/uploads").field("purpose", "student-document").attach("file", PDF, "x.pdf");
    const ok = await request(app).get(body.url);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toBe("application/pdf");
    expect(ok.headers["content-security-policy"]).toContain("sandbox");

    const url = new URL(body.url, "http://x");
    expect((await request(app).get(`${url.pathname}?expires=${url.searchParams.get("expires")}&signature=forged`)).status).toBe(403);
    const past = Math.floor(Date.now() / 1000) - 60;
    expect((await request(app).get(`${url.pathname}?expires=${past}&signature=${url.searchParams.get("signature")}`)).status).toBe(403);
  });

  it("lets visitors upload application documents only, and only attach their own unused files", async () => {
    const visitor = () => request(app).post("/api/v1/uploads").set("Origin", ORIGIN);
    expect((await visitor().field("purpose", "student-photo").attach("file", PDF, "x.pdf")).status).toBe(401);
    const file = (await visitor().field("purpose", "application-document").attach("file", PDF, "birth.pdf")).body;
    const apply = (email: string, key: string) =>
      request(app)
        .post("/api/v1/applications")
        .set("Origin", ORIGIN)
        .set("Idempotency-Key", key)
        .send({
          applyingGradeId: "grade_3",
          student: { firstName: "Nimal", lastName: "Visitor", gender: "M", dob: "2018-02-02", address: "Kandy" },
          guardian: { name: "Mr. Visitor", relationship: "Father", phone: "0771239876", email },
          documents: [{ name: "birth.pdf", size: 10, kind: "birth_certificate", fileId: file.id }],
        });
    const first = await apply(`v.${unique()}@example.com`, unique());
    expect(first.status).toBe(200);
    // Someone else reusing that file id (e.g. guessed from a link) is refused.
    const second = await apply(`w.${unique()}@example.com`, unique());
    expect(second.status).toBe(422);
  });
});

describe("students", () => {
  it("admits a student once per request key, with guardian and first invoice", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const key = unique();
    const body = newStudent({ discountIds: ["disc_merit"] });
    const first = await admin.post("/api/v1/students").set("Idempotency-Key", key).send(body);
    expect(first.status).toBe(200);
    const retry = await admin.post("/api/v1/students").set("Idempotency-Key", key).send(body);
    expect(retry.body.id).toBe(first.body.id);
    expect(await prisma.student.count({ where: { lastName: body.lastName as string } })).toBe(1);
    const changed = await admin.post("/api/v1/students").set("Idempotency-Key", key).send({ ...body, firstName: "Other" });
    expect(changed.status).toBe(422);

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { studentId: first.body.id }, include: { lines: true } });
    const byType = Object.fromEntries(invoice.lines.map((l) => [l.feeTypeId, l]));
    expect(Object.keys(byType).sort()).toEqual(["fee_admission", "fee_deposit", "fee_tuition"]);
    // The merit scholarship (25%) applies to tuition only.
    expect(Number(byType.fee_tuition!.discount)).toBe(Number(byType.fee_tuition!.amount) * 0.25);
    expect(Number(byType.fee_admission!.discount)).toBe(0);
    expect(first.body.balance).toBe(Number(invoice.total));
    expect(invoice.monthlyKey).toMatch(new RegExp(`^${first.body.id}\\|\\d{4}-\\d{2}$`));
  });

  it("links a guardian already on file instead of duplicating them", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const res = await admin.post("/api/v1/students").send(newStudent({ guardian: { name: "Mrs. Dilani Perera", relationship: "Mother", phone: "074 109 7218", email: "PARENT@whizchool.lk" } }));
    expect(res.status).toBe(200);
    const parent = await signIn("parent@whizchool.lk");
    expect((await parent.get("/api/v1/auth/me")).body.studentIds).toContain(res.body.id);
    expect(await prisma.guardian.count({ where: { email: "parent@whizchool.lk" } })).toBe(1);
  });

  it("links by phone only when the names agree (parents often share one phone)", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const phone = `0772${Math.floor(100_000 + Math.random() * 899_999)}`;
    const first = await admin.post("/api/v1/students").send(newStudent({ guardian: { name: "Mr. Upul Abeysekara", relationship: "Father", phone } }));
    const spouse = await admin.post("/api/v1/students").send(newStudent({ guardian: { name: "Mrs. Gayani Abeysekara", relationship: "Mother", phone } }));
    const sameDad = await admin.post("/api/v1/students").send(newStudent({ guardian: { name: "U. Abeysekara", relationship: "Father", phone } }));
    const guardianOf = async (id: string) => (await prisma.studentGuardian.findFirstOrThrow({ where: { studentId: id } })).guardianId;
    expect(await guardianOf(spouse.body.id)).not.toBe(await guardianOf(first.body.id));
    expect(await guardianOf(sameDad.body.id)).toBe(await guardianOf(first.body.id));
  });

  it("applies data scope to lists and profiles", async () => {
    const teacher = await signIn("teacher@whizchool.lk");
    const me = (await teacher.get("/api/v1/auth/me")).body;
    const list = (await teacher.get("/api/v1/students").query({ pageSize: 100 })).body;
    const classes = new Set(list.items.map((s: { classId: string }) => s.classId));
    expect(list.total).toBeGreaterThan(0);
    const allowed = new Set([...me.classIds, ...(await prisma.classSubject.findMany({ where: { id: { in: me.classSubjectIds } } })).map((c) => c.classId)]);
    expect([...classes].every((c) => allowed.has(c))).toBe(true);
    expect(list.items.every((s: { balance: number }) => s.balance === 0)).toBe(true);
    const parent = await signIn("parent@whizchool.lk");
    const children: string[] = (await parent.get("/api/v1/auth/me")).body.studentIds;
    // Neither the teacher's student nor the parent's child (an earlier test links a sibling to this parent).
    const outsider = await prisma.student.findFirstOrThrow({ where: { classId: { notIn: [...allowed] }, id: { notIn: children } } });
    expect((await teacher.get(`/api/v1/students/${outsider.id}`)).status).toBe(403);

    expect((await parent.get("/api/v1/students")).status).toBe(403);
    const [childId] = children;
    expect((await parent.get(`/api/v1/students/${childId}`)).status).toBe(200);
    expect((await parent.get(`/api/v1/students/${outsider.id}`)).status).toBe(403);
  });

  it("finds students by name, admission number or a guardian's phone", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const kavindu = await prisma.student.findFirstOrThrow({ where: { firstName: "Kavindu", lastName: "Perera" }, include: { guardians: { include: { guardian: true } } } });
    const byName = (await admin.get("/api/v1/students").query({ search: "kavindu perera" })).body;
    expect(byName.items.map((s: { id: string }) => s.id)).toContain(kavindu.id);
    expect((await admin.get("/api/v1/students").query({ search: kavindu.admissionNo })).body.items[0].id).toBe(kavindu.id);
    const phone = kavindu.guardians[0]!.guardian.phone.replace(/\s/g, "");
    expect((await admin.get("/api/v1/students").query({ search: phone })).body.items.map((s: { id: string }) => s.id)).toContain(kavindu.id);
  });

  it("removes a student who leaves from their parent's portal", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const res = await admin.post("/api/v1/students").send(newStudent({ guardian: { name: "Mrs. Leaving", relationship: "Mother", phone: "0770001122", email: `leaving.${unique()}@example.com` }, inviteParent: true }));
    expect(res.body.inviteLink).toMatch(/^\/invite\//);
    const parent = client();
    await parent.post(`/api/v1/auth/invites/${res.body.inviteLink.split("/").pop()}/accept`).send({ password: "parent-pass-1" });
    expect((await parent.get("/api/v1/auth/me")).body.studentIds).toEqual([res.body.id]);
    expect((await admin.post(`/api/v1/students/${res.body.id}/status`).send({ status: "left", date: "2026-10-01", reason: "Moved abroad" })).status).toBe(200);
    expect((await parent.get("/api/v1/auth/me")).body.studentIds).toEqual([]);
  });
});
