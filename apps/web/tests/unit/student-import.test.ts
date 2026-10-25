import { describe, expect, it } from "vitest";
import { normalizeLocalPhone } from "@whizchool/shared/phone";
import {
  checkImportRow,
  matchColumns,
  normalizeClassName,
  parseImportDate,
  parseImportGender,
  rowsFromTable,
} from "@whizchool/shared/student-import";
import type { ImportRow } from "@whizchool/shared/types";

describe("matchColumns", () => {
  it("recognises columns by header, in any order and spelling", () => {
    const headers = ["Surname", "  First Name ", "D.O.B", "Sex", "Grade/Class", "Parent's Name", "Mobile No", "E-mail", "House colour"];
    const m = matchColumns(headers);
    expect(m.fields).toMatchObject({ lastName: 0, firstName: 1, dob: 2, gender: 3, className: 4, guardianName: 5, guardianPhone: 6, guardianEmail: 7 });
    expect(m.missing).toEqual([]);
    expect(m.unmatched).toEqual([8]);
  });

  it("names the required columns a file lacks and flags columns claimed twice", () => {
    const m = matchColumns(["First Name", "Last Name", "Phone", "Mobile"]);
    expect(m.missing).toEqual(["gender", "dob", "className", "guardianName"]);
    expect(m.duplicates).toEqual([{ field: "guardianPhone", columns: [2, 3] }]);
    expect(m.fields.guardianPhone).toBe(2);
  });

  it("strips a byte-order mark from the first header", () => {
    expect(matchColumns(["﻿firstName"]).fields.firstName).toBe(0);
  });
});

describe("rowsFromTable", () => {
  it("reads cells through the mapping and drops blank rows", () => {
    const rows = rowsFromTable(
      [
        ["Perera", "Kavindu"],
        ["", " "],
      ],
      { lastName: 0, firstName: 1 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ firstName: "Kavindu", lastName: "Perera", gender: "" });
  });
});

describe("cell values", () => {
  it.each([
    ["2016-03-14", "2016-03-14"],
    ["14/03/2016", "2016-03-14"],
    ["4/3/2016", "2016-03-04"],
    ["14-03-2016", "2016-03-14"],
    ["14.03.2016", "2016-03-14"],
    ["14 Mar 2016", "2016-03-14"],
    ["14-March-2016", "2016-03-14"],
    ["March 14, 2016", "2016-03-14"],
    ["2016/3/14", "2016-03-14"],
  ])("reads the date %s", (raw, iso) => {
    expect(parseImportDate(raw)).toEqual({ value: iso });
  });

  it("reads day-first, and warns when only month-first makes sense", () => {
    expect(parseImportDate("05/14/2015")).toMatchObject({ value: "2015-05-14", warning: expect.stringMatching(/month\/day/) });
    expect(parseImportDate("31/02/2016").error).toBeTruthy();
    expect(parseImportDate("14/03/16").error).toMatch(/4-digit year/);
    expect(parseImportDate("yesterday").error).toBeTruthy();
    expect(parseImportDate("")).toEqual({});
  });

  it("reads gender words and class names", () => {
    expect(["M", "male", "Boy", "f", "FEMALE", "girl", "x"].map(parseImportGender)).toEqual(["M", "M", "M", "F", "F", "F", null]);
    expect(["10A", "10 a", "10-A", "Grade 10 A", "gr. 10/a", "12-ps", "10", "10-1", "10 COM2"].map(normalizeClassName)).toEqual([
      "10-A",
      "10-A",
      "10-A",
      "10-A",
      "10-A",
      "12-PS",
      "10",
      "10-1",
      "10-COM2",
    ]);
  });

  it("restores phone numbers spreadsheets mangle", () => {
    expect(normalizeLocalPhone("771234567")).toBe("077 123 4567");
    expect(normalizeLocalPhone("+94 81 222 4567")).toBe("081 222 4567");
    expect(normalizeLocalPhone("0771234567")).toBe("077 123 4567");
    expect(normalizeLocalPhone("12345")).toBeNull();
  });
});

describe("checkImportRow", () => {
  const base: ImportRow = {
    admissionNo: "10999.0",
    firstName: " Senul ",
    lastName: "Abeysekara",
    gender: "Male",
    dob: "14/03/2016",
    className: "4a",
    guardianName: "Mr.  Upul Abeysekara",
    guardianPhone: "774561290",
    guardianEmail: "Upul@Gmail.com",
    guardianRelationship: "father",
    address: "12 Lake Drive",
    religion: "",
    joinedDate: "",
  };

  it("cleans every value into the stored form", () => {
    const { data, errors, warnings } = checkImportRow(base, "2026-10-25");
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(data).toMatchObject({
      admissionNo: "10999",
      firstName: "Senul",
      gender: "M",
      dob: "2016-03-14",
      className: "4-A",
      guardianName: "Mr. Upul Abeysekara",
      guardianPhone: "077 456 1290",
      guardianEmail: "upul@gmail.com",
      guardianRelationship: "Father",
    });
  });

  it("explains every problem in a row", () => {
    const { errors, warnings } = checkImportRow(
      { ...base, firstName: "", gender: "X", dob: "2030-01-01", className: "4", guardianPhone: "123", guardianEmail: "nope", joinedDate: "soon" },
      "2026-10-25",
    );
    expect(errors).toEqual([
      "First name is missing",
      "Gender “X” must be M or F",
      "Date of birth is in the future",
      "Class “4” needs a section, e.g. 4-A",
      "Guardian phone “123” isn't a Sri Lankan number",
      "Guardian email “nope” isn't valid",
      expect.stringMatching(/^Admission date: /),
    ]);
    expect(warnings).toEqual([]);
  });

  it("warns about missing email, unusual ages and two phone numbers in one cell", () => {
    const { errors, warnings } = checkImportRow({ ...base, guardianEmail: "", dob: "2001-01-01", guardianPhone: "0771234567 / 0712223333" }, "2026-10-25");
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      "Age 25 looks unusual for a school student",
      "Kept the first phone number of “0771234567 / 0712223333”",
      "No guardian email: the parent can't be invited to the portal",
    ]);
  });
});
