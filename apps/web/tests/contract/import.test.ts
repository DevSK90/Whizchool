import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, resetData } from "./helpers";

beforeAll(() => resetData());

/** A row the way a school's spreadsheet might have it, before cleaning. */
const row = (over: Record<string, string> = {}) => ({
  admissionNo: "",
  firstName: "Senul",
  lastName: "Imported",
  gender: "Male",
  dob: "14/03/2016",
  className: "4a",
  guardianName: "Mr. Upul Imported",
  guardianPhone: "774561290",
  guardianEmail: "",
  guardianRelationship: "father",
  address: "12 Lake Drive, Kandy",
  religion: "",
  joinedDate: "05/01/2022",
  ...over,
});

describe("student import", () => {
  it("is limited to staff with import.create", async () => {
    await login("teacher");
    await expectStatus(403, call("POST", "/imports/students/preview", { rows: [row()] }));
  });

  it("cleans values and explains every problem before anything is saved", async () => {
    await login("admin");
    const preview = await call("POST", "/imports/students/preview", {
      rows: [
        row(),
        row({ firstName: "Nethmi", className: "99-Z" }),
        row({ firstName: "Kasun", admissionNo: "10850" }),
        row({ firstName: "Dilini", admissionNo: "90001" }),
        row({ firstName: "Hiruni", admissionNo: "90001" }),
        row({ firstName: "", gender: "?", guardianPhone: "123" }),
        row({ firstName: "Sibling", guardianEmail: "parent@whizchool.lk", guardianPhone: "074 109 7218" }),
      ],
    });
    expect(preview).toMatchObject({ valid: 3, invalid: 4 });
    const [ok, noClass, taken, first, repeat, broken, sibling] = preview.rows;
    expect(ok.data).toMatchObject({ gender: "M", dob: "2016-03-14", className: "4-A", guardianPhone: "077 456 1290", guardianRelationship: "Father", joinedDate: "2022-01-05" });
    expect(ok.errors).toEqual([]);
    expect(noClass.errors).toContain("No class “99-Z” this year");
    expect(taken.errors).toContain("Admission no. 10850 already exists");
    expect(first.errors).toEqual([]);
    expect(repeat.errors).toContain("Admission no. 90001 is also on row 4");
    expect(broken.errors).toEqual(expect.arrayContaining(["First name is missing", "Gender “?” must be M or F", "Guardian phone “123” isn't a Sri Lankan number"]));
    expect(sibling.warnings.join(" ")).toMatch(/already on file/);
  });

  it("imports only valid rows, once per request key, without admission invoices", async () => {
    await login("admin");
    const rows = [
      row({ firstName: "Commit", admissionNo: "90101" }),
      row({ firstName: "Second", admissionNo: "90102", guardianEmail: "parent@whizchool.lk", guardianPhone: "074 109 7218" }),
      row({ firstName: "Broken", className: "99-Z" }),
    ];
    const result = await call("POST", "/imports/students/commit", { rows, inviteParents: false }, undefined, "import-1");
    expect(result).toMatchObject({ created: 2, skipped: 1 });
    expect(result.errors).toEqual([{ index: 3, errors: ["No class “99-Z” this year"] }]);
    const replay = await call("POST", "/imports/students/commit", { rows, inviteParents: false }, undefined, "import-1");
    expect(replay.created).toBe(2);

    const found = await get("/students", { search: "90101" });
    expect(found.total).toBe(1);
    const student = await get(`/students/${found.items[0].id}`);
    expect(student).toMatchObject({ className: "4-A", joinedDate: "2022-01-05", dob: "2016-03-14", balance: 0 });

    // The second row's guardian is the existing parent: linked, not duplicated, and visible to them.
    const sibling = (await get("/students", { search: "90102" })).items[0];
    await login("parent");
    expect((await get("/auth/me")).studentIds).toContain(sibling.id);

    await login("admin");
    await expectStatus(422, call("POST", "/imports/students/commit", { rows: [row({ className: "99-Z" })] }));
  });
});
