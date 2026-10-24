import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, resetMockData, type Json } from "./helpers";

beforeAll(() => resetMockData());

const PHOTO = { name: "me.jpg", size: 2048, mimeType: "image/jpeg", purpose: "student-photo", dataUrl: "data:image/jpeg;base64,AAAA" };

describe("students", () => {
  let student: Json;

  it("searches, paginates and opens a profile", async () => {
    await login("admin");
    const page = await get("/students", { search: "Perera", pageSize: 5 });
    expect(page.items.length).toBeLessThanOrEqual(5);
    expect(page.total).toBeGreaterThan(0);
    student = await get(`/students/${page.items[0].id}`);
    expect(student.guardians.length).toBeGreaterThan(0);
    expect(student.documents).toEqual([]);
    for (const tab of ["attendance", "results", "invoices", "payments"]) await get(`/students/${student.id}/${tab}`);
  });

  it("uploads, replaces and removes a photo", async () => {
    await expectStatus(415, call("POST", "/uploads", { ...PHOTO, mimeType: "application/pdf" }));
    const file = await call("POST", "/uploads", PHOTO);
    const doc = await call("POST", "/uploads", { ...PHOTO, mimeType: "application/pdf", purpose: "student-document" });
    await expectStatus(422, call("PUT", `/students/${student.id}/photo`, { fileId: doc.id }));
    await call("PUT", `/students/${student.id}/photo`, { fileId: file.id });
    expect((await get(`/students/${student.id}`)).photoUrl).toBe(PHOTO.dataUrl);
    await call("PUT", `/students/${student.id}/photo`, { fileId: null });
    expect((await get(`/students/${student.id}`)).photoUrl).toBeUndefined();
  });

  it("adds and removes documents", async () => {
    const file = await call("POST", "/uploads", { name: "medical.pdf", size: 5000, mimeType: "application/pdf", purpose: "student-document" });
    await expectStatus(422, call("POST", `/students/${student.id}/documents`, { fileId: file.id, kind: "passport" }));
    const doc = await call("POST", `/students/${student.id}/documents`, { fileId: file.id, kind: "medical" });
    expect(doc.file.name).toBe("medical.pdf");
    expect((await get(`/students/${student.id}`)).documents).toHaveLength(1);
    await call("DELETE", `/students/${student.id}/documents/${doc.id}`);
    expect((await get(`/students/${student.id}`)).documents).toHaveLength(0);
    await expectStatus(404, call("DELETE", `/students/${student.id}/documents/${doc.id}`));
  });

  it("adds a guardian, links an existing one for siblings, and keeps at least one", async () => {
    const created = await call("POST", `/students/${student.id}/guardians`, {
      name: "Mr. New",
      relationship: "Father",
      phone: "071 999 8888",
      email: "mr.new@example.com",
      inviteParent: true,
    });
    expect(created.linked).toBe(false);
    expect(created.inviteLink).toMatch(/\/invite\//);

    // The same phone on another student links the existing guardian instead of creating a duplicate.
    const sibling = (await get("/students", { pageSize: 50 })).items.find((s: Json) => s.id !== student.id);
    const again = { name: "Mr. New", relationship: "Father", phone: "071 999 8888" };
    const linked = await call("POST", `/students/${sibling.id}/guardians`, again);
    expect(linked).toMatchObject({ linked: true, guardian: { id: created.guardian.id } });
    await expectStatus(409, call("POST", `/students/${sibling.id}/guardians`, again));
    await expectStatus(422, call("POST", `/students/${sibling.id}/guardians`, { name: "", relationship: "Uncle", phone: "123" }));

    const profile = await get(`/students/${student.id}`);
    for (const g of profile.guardians.slice(0, -1)) await call("DELETE", `/students/${student.id}/guardians/${g.id}`);
    await expectStatus(409, call("DELETE", `/students/${student.id}/guardians/${profile.guardians.at(-1).id}`));
  });

  it("enforces permissions and data scope", async () => {
    await login("accountant");
    await expectStatus(403, call("PUT", `/students/${student.id}/photo`, { fileId: null }));
    await login("parent");
    const [child] = await get("/portal/children");
    await get(`/students/${child.id}`);
    await expectStatus(403, get(`/students/${student.id}`));
    await expectStatus(403, call("POST", `/students/${child.id}/guardians`, { name: "X", relationship: "Guardian", phone: "077 000 0000" }));
  });
});
