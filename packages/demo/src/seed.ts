// Deterministic demo dataset: a ~670-student private school (Grades 1–13, A/L streams) for 2026.
import { addDays, format, getDay, parseISO } from "date-fns";
import { ALL_PERMISSIONS, type PermissionKey } from "@whizchool/shared/permissions";
import { CURRICULUM_STREAMS, CURRICULUM_SUBJECTS, optionGroupFor, type OfferedSubject } from "@whizchool/shared/curriculum";
import { DEFAULT_SCHOOL_DAY, type StoredBlock } from "@whizchool/shared/timetable";
import { DEFAULT_GRADE_BANDS } from "@whizchool/shared/grading";
import type {
  ClassSection,
  Discount,
  Exam,
  FeeType,
  Grade,
  GradeLevel,
  Guardian,
  Invoice,
  InvoiceLine,
  Payment,
  PaymentMethod,
  Role,
  Staff,
  Student,
  Subject,
} from "@whizchool/shared/types";
import { Table, nextId, nextNumber, type DB, type MockUser } from "./db";
import { clamp, createRng, type Rng } from "./rng";

import { DEMO_PASSWORD } from "./demo-accounts";

/** The dataset is generated "as of" this school day; the app itself uses the real clock. */
export const SEED_DATE = "2026-10-23";

const BOY_NAMES = [
  "Kavindu", "Sahan", "Dinuka", "Tharindu", "Pasindu", "Nimesh", "Ravindu", "Isuru", "Chamod", "Yasiru",
  "Kasun", "Lahiru", "Dulaj", "Senuk", "Methsara", "Thisara", "Akila", "Hasitha", "Arjun", "Karthik",
  "Pravin", "Nirmal", "Imran", "Ashfaq", "Rizwan", "Dilshan", "Janith", "Sachin", "Vihanga", "Oshada",
];
const GIRL_NAMES = [
  "Nethmi", "Sanduni", "Kavya", "Tharushi", "Dilini", "Hiruni", "Senuri", "Imesha", "Piumi", "Nadeesha",
  "Ishara", "Methmi", "Sithumi", "Anjali", "Priya", "Kavitha", "Fathima", "Ayesha", "Shazna", "Dinithi",
  "Hansini", "Chamodi", "Yashodha", "Nilakshi", "Rashmi", "Sewmini", "Hasini", "Thilini", "Vinuri", "Amaya",
];
const SURNAMES = [
  "Perera", "Fernando", "Silva", "Jayasinghe", "Wickramasinghe", "Bandara", "Dissanayake", "Herath",
  "Rathnayake", "Gunawardena", "Senanayake", "Karunaratne", "Wijesinghe", "Ranasinghe", "Abeysekara",
  "Kumara", "Samarasinghe", "Weerasinghe", "Gamage", "Liyanage", "Sivakumar", "Rajendran", "Krishnan",
  "Shanmugam", "Navaratnam", "Mohamed", "Hussain", "Farook", "Ismail", "Mendis", "De Alwis", "Peiris",
];
const MEN = ["Saman", "Nuwan", "Chaminda", "Pradeep", "Ruwan", "Asanka", "Mahesh", "Lalith", "Sunil", "Rohan", "Suresh", "Nalin", "Ajith", "Prasanna", "Kumar", "Fazil", "Roshan", "Upul"];
const WOMEN = ["Dilani", "Shiromi", "Chandima", "Nadeeka", "Sanjeewani", "Kumari", "Anoma", "Malini", "Priyanka", "Thilini", "Shanthi", "Lakmini", "Fathima", "Nirosha", "Sriyani", "Gayani"];
const CITIES = ["Kandy", "Peradeniya", "Katugastota", "Gampola", "Kundasale", "Digana", "Pilimathalawa", "Kadugannawa", "Ampitiya", "Matale"];
const STREETS = ["Temple Road", "Lake Drive", "Hill Street", "Peradeniya Road", "Station Road", "Church Lane", "Galaha Road", "Dharmaraja Mawatha", "Mahamaya Mawatha", "Kings Street"];

const LEVEL_OF = (n: number): GradeLevel => (n <= 5 ? "primary" : n <= 9 ? "junior" : n <= 11 ? "ol" : "al");

// What the demo school offers, from the national curriculum: a school doesn't teach all of it.
const STREAM_OFFERS: Record<string, string[]> = {
  PS: ["CMATH", "PHY", "CHEM", "AICT", "GENG", "CGT"],
  BS: ["BIO", "CHEM", "PHY", "AGRI", "GENG", "CGT"],
  COM: ["ACC", "BST", "ECON", "BSTAT", "AICT", "GENG", "CGT"],
  ART: ["POL", "ALSIN", "AGEO", "ECON", "HISC", "BUDD", "AART", "GENG", "CGT"],
  ET: ["ETEC", "SFT", "CIVT", "EEIT", "AICT", "GENG", "CGT"],
  BT: ["BTEC", "SFT", "FOOD", "AGRO", "BIOR", "GENG", "CGT"],
};
const STREAMS: [string, string, string[]][] = CURRICULUM_STREAMS.map((s) => [s.code, s.name, STREAM_OFFERS[s.code]!]);

const PRIMARY_SUBJECTS = ["SIN", "ENG", "MAT", "ENV", "REL", "ART"];
const JUNIOR_SUBJECTS = ["SIN", "ENG", "MAT", "SCI", "HIS", "GEO", "CIV", "REL", "HPE", "ICT", "TAM", "ART"];
const OL_CORE = ["ENG", "MAT", "SCI", "HIS", "SIN", "TML", "BUD", "HIN", "ISL", "CHR"];
const OL_BASKETS: Record<1 | 2 | 3, string[]> = { 1: ["BUS", "GEO", "CIV"], 2: ["ART", "MUSE", "ELIT"], 3: ["ICT", "HPE", "AGR"] };

// teacher specialties: subject code → number of teachers
const SPECIALISTS: [string, number][] = [
  ["SIN", 3], ["TML", 1], ["ENG", 4], ["MAT", 3], ["SCI", 3], ["HIS", 2], ["GEO", 2], ["CIV", 1], ["REL", 2],
  ["BUD", 1], ["HIN", 1], ["ISL", 1], ["CHR", 1], ["HPE", 2], ["ICT", 2], ["TAM", 1], ["ART", 2], ["MUSE", 1], ["BUS", 2], ["ELIT", 1], ["AGR", 1],
  ["CMATH", 1], ["PHY", 1], ["CHEM", 1], ["BIO", 1], ["ACC", 1], ["BST", 1], ["ECON", 1], ["POL", 1], ["BSTAT", 1],
  ["ETEC", 1], ["BTEC", 1], ["SFT", 1], ["CIVT", 1], ["EEIT", 1], ["FOOD", 1], ["AGRO", 1], ["BIOR", 1],
];
// A/L subjects taught by the teachers of their O/L counterpart.
const SHARED_TEACHERS: Record<string, string> = { GENG: "ENG", CGT: "ENG", AICT: "ICT", AGEO: "GEO", ALSIN: "SIN", AART: "ART", AGRI: "AGR", BUDD: "BUD", HISC: "HIS" };

const TUITION: Record<GradeLevel, number> = { primary: 12500, junior: 15000, ol: 17500, al: 20000 };

function phone(rng: Rng) {
  return `07${rng.pick(["0", "1", "2", "4", "5", "6", "7", "8"])} ${rng.int(100, 999)} ${rng.int(1000, 9999)}`;
}

function iso(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function at(date: string, hour: number, minute = 0) {
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`;
}

export function schoolDays(from: string, to: string) {
  const days: string[] = [];
  for (let d = parseISO(from); iso(d) <= to; d = addDays(d, 1)) {
    const wd = getDay(d);
    if (wd !== 0 && wd !== 6) days.push(iso(d));
  }
  return days;
}

function defaultRoles(): Role[] {
  const pick = (...keys: PermissionKey[]) => keys;
  return [
    {
      id: "role_admin", name: "Admin", system: true, scope: "all",
      description: "Full access to every module and setting.",
      permissions: [...ALL_PERMISSIONS],
    },
    {
      id: "role_principal", name: "Principal", system: true, scope: "all",
      description: "Oversees the school; approves admissions, results and promotions.",
      permissions: pick(
        "dashboard.view", "admissions.view", "admissions.edit", "admissions.approve", "students.view",
        "classes.view", "timetable.view", "timetable.edit", "attendance.view", "marks.view", "reportCards.view", "reportCards.edit",
        "reportCards.approve", "promotions.view", "promotions.approve", "fees.view", "payments.view",
        "messaging.view", "messaging.create", "users.view", "roles.view", "settings.view", "audit.view",
      ),
    },
    {
      id: "role_class_teacher", name: "Class Teacher", system: true, scope: "own_class",
      description: "Marks attendance and writes report-card remarks for their own class.",
      permissions: pick(
        "dashboard.view", "students.view", "classes.view", "timetable.view", "attendance.view", "attendance.create",
        "attendance.edit", "marks.view", "reportCards.view", "reportCards.edit", "messaging.view",
      ),
    },
    {
      id: "role_subject_teacher", name: "Subject Teacher", system: true, scope: "own_subjects",
      description: "Enters term-test marks for the subjects and classes they teach.",
      permissions: pick("dashboard.view", "students.view", "classes.view", "timetable.view", "marks.view", "marks.create", "marks.edit"),
    },
    {
      id: "role_accountant", name: "Accountant", system: true, scope: "all",
      description: "Manages fees, invoices, payments and receipts.",
      permissions: pick(
        "dashboard.view", "students.view", "classes.view", "fees.view", "fees.create", "fees.edit",
        "payments.view", "payments.create", "payments.approve", "messaging.view", "messaging.create",
      ),
    },
    {
      id: "role_parent", name: "Parent", system: true, scope: "own_children",
      description: "Parent portal access to their own children only.",
      permissions: [],
    },
    {
      id: "role_office", name: "Office Staff", system: false, scope: "all",
      description: "Front-office: admissions and student records.",
      permissions: pick(
        "dashboard.view", "admissions.view", "admissions.create", "admissions.edit", "students.view",
        "students.create", "students.edit", "classes.view", "timetable.view", "import.create",
      ),
    },
  ];
}

/**
 * "standard" is the demo school (about 650 students). "large" has four sections per grade below A/L and
 * fuller classes, about 1,600 students, for checking the API's speed at a big school's size.
 */
export type SeedSize = "standard" | "large";

/**
 * Every class gets a clash-free week of 40-minute lessons, placed greedily and without the seed's random
 * numbers so everything generated before it stays the same. One class (8-B) stays an unpublished draft.
 */
function seedTimetables(db: DB, classes: ClassSection[]) {
  const dayStart = DEFAULT_SCHOOL_DAY.start;
  const firstLessons = dayStart + 10;
  const interval = { start: firstLessons + 4 * 40, end: firstLessons + 4 * 40 + 30 };
  const lessonStarts = [0, 1, 2, 3].map((i) => firstLessons + i * 40).concat([0, 1, 2, 3].map((i) => interval.end + i * 40));
  const teacherBusy = new Set<string>();
  // A/L first: a class's options need several teachers free at once, and those teachers are few.
  for (const c of [...classes].sort((a, b) => Number(b.streamId != null) - Number(a.streamId != null))) {
    const subjects = db.classSubjects.rows.filter((cs) => cs.classId === c.id);
    // Subjects students choose between run together, so they're placed as one unit.
    const units = new Map<string, typeof subjects>();
    for (const cs of subjects) {
      const key = cs.optionGroup ?? cs.id;
      units.set(key, [...(units.get(key) ?? []), cs]);
    }
    const rotation = [...units.values()];
    const blocks: Omit<StoredBlock, "id" | "version">[] = [];
    let next = 0;
    for (const day of [1, 2, 3, 4, 5]) {
      blocks.push({ classId: c.id, day, start: dayStart, end: firstLessons, kind: "activity", label: "Assembly" });
      blocks.push({ classId: c.id, day, start: interval.start, end: interval.end, kind: "interval", label: "Interval" });
      const today = new Map<(typeof subjects)[number][], number>();
      for (const start of lessonStarts) {
        for (let tried = 0; tried < rotation.length; tried++) {
          const unit = rotation[(next + tried) % rotation.length]!;
          const keys = unit.flatMap((cs) => (cs.teacherId ? [`${cs.teacherId}|${day}|${start}`] : []));
          if ((today.get(unit) ?? 0) >= 2 || keys.some((k) => teacherBusy.has(k))) continue;
          for (const k of keys) teacherBusy.add(k);
          for (const cs of unit) blocks.push({ classId: c.id, day, start, end: start + 40, kind: "lesson", classSubjectId: cs.id });
          today.set(unit, (today.get(unit) ?? 0) + 1);
          next = (next + tried + 1) % rotation.length;
          break;
        }
      }
    }
    const live = c.name !== "8-B";
    blocks.forEach((b, i) => {
      db.timetableBlocks.push({ ...b, id: `ttb_${c.id.slice(4)}_d${i}`, version: "draft" });
      if (live) db.timetableBlocks.push({ ...b, id: `ttb_${c.id.slice(4)}_p${i}`, version: "published" });
    });
    db.timetables.push({ classId: c.id, revision: 1, savedBy: "Mrs. Anoma Wijesinghe", ...(live ? { publishedRevision: 1, publishedAt: "2026-01-05T08:00:00+05:30", publishedBy: "Mrs. Anoma Wijesinghe" } : {}) });
  }
}

export function createSeed(size: SeedSize = "standard"): DB {
  const large = size === "large";
  const sectionsBelowAL = large ? ["A", "B", "C", "D"] : ["A", "B"];
  const rng = createRng(20261023);
  const db: DB = {
    school: {
      name: "Whizchool Demo College",
      shortName: "WDC",
      motto: "Learn · Lead · Inspire",
      address: "42 Peradeniya Road, Kandy 20000",
      phone: "081 222 4567",
      email: "info@whizchool.lk",
      website: "www.whizchool.lk",
      principalName: "Mrs. Anoma Wijesinghe",
      currency: "LKR",
      timezone: "Asia/Colombo",
      currentYearId: "year_2026",
      smsSenderId: "WHIZCHOOL",
      timetableStart: DEFAULT_SCHOOL_DAY.start,
      timetableEnd: DEFAULT_SCHOOL_DAY.end,
    },
    years: new Table([
      { id: "year_2025", name: "2025", startDate: "2025-01-02", endDate: "2025-12-05", status: "closed" },
      { id: "year_2026", name: "2026", startDate: "2026-01-02", endDate: "2026-12-04", status: "active" },
    ]),
    terms: new Table([
      { id: "term_2026_1", yearId: "year_2026", number: 1, name: "Term 1", startDate: "2026-01-02", endDate: "2026-04-10" },
      { id: "term_2026_2", yearId: "year_2026", number: 2, name: "Term 2", startDate: "2026-04-20", endDate: "2026-08-14" },
      { id: "term_2026_3", yearId: "year_2026", number: 3, name: "Term 3", startDate: "2026-08-24", endDate: "2026-12-04" },
    ]),
    grades: new Table<Grade>(
      Array.from({ length: 13 }, (_, i) => ({ id: `grade_${i + 1}`, number: i + 1, name: `Grade ${i + 1}`, level: LEVEL_OF(i + 1) })),
    ),
    streams: new Table(CURRICULUM_STREAMS.map(({ code, name, optionsRequired }) => ({ id: `stream_${code.toLowerCase()}`, code, name, optionsRequired }))),
    classes: new Table(),
    subjects: new Table<Subject>(
      CURRICULUM_SUBJECTS.map(({ code, ...s }) => {
        const inStreams = (list: "core" | "options") => CURRICULUM_STREAMS.filter((x) => x[list].includes(code)).map((x) => `stream_${x.code.toLowerCase()}`);
        return {
          ...s, id: `sub_${code.toLowerCase()}`, code, teacherIds: [],
          ...(s.levels.includes("al") ? { streamIds: [...inStreams("core"), ...inStreams("options")], optionalStreamIds: inStreams("options") } : {}),
        };
      }),
    ),
    classSubjects: new Table(),
    timetables: [],
    timetableBlocks: [],
    gradeBands: DEFAULT_GRADE_BANDS.map((b) => ({ ...b })),
    staff: new Table(),
    guardians: new Table(),
    students: new Table(),
    enrollments: new Table(),
    users: new Table(),
    roles: new Table(defaultRoles()),
    tokens: new Map(),
    applications: new Table(),
    attendance: new Map(),
    exams: new Table<Exam>([
      { id: "exam_2026_1", yearId: "year_2026", termId: "term_2026_1", name: "Term 1 Test 2026", termName: "Term 1", status: "released", startDate: "2026-03-30", endDate: "2026-04-07" },
      { id: "exam_2026_2", yearId: "year_2026", termId: "term_2026_2", name: "Term 2 Test 2026", termName: "Term 2", status: "released", startDate: "2026-08-03", endDate: "2026-08-11" },
      { id: "exam_2026_3", yearId: "year_2026", termId: "term_2026_3", name: "Term 3 Test 2026", termName: "Term 3", status: "marks_entry", startDate: "2026-10-12", endDate: "2026-10-21" },
    ]),
    marks: new Map(),
    submittedSheets: new Set(),
    reportStatus: new Map(),
    remarks: new Map(),
    feeTypes: new Table<FeeType>([
      { id: "fee_tuition", name: "Tuition fee", recurrence: "monthly", active: true, description: "Billed on the 1st of every month, due on the 10th." },
      { id: "fee_admission", name: "Admission fee", recurrence: "one_time", active: true, description: "Charged once on enrollment." },
      { id: "fee_deposit", name: "Refundable deposit", recurrence: "one_time", active: true, description: "Refunded when the student leaves." },
      { id: "fee_exam", name: "Term test fee", recurrence: "ad_hoc", active: true, description: "Charged with each term test." },
      { id: "fee_sports", name: "Sports meet", recurrence: "ad_hoc", active: true },
      { id: "fee_trip", name: "Educational trip", recurrence: "ad_hoc", active: true },
      { id: "fee_books", name: "Books & stationery", recurrence: "ad_hoc", active: true },
    ]),
    feeStructures: new Table(),
    discounts: new Table<Discount>([
      { id: "disc_sibling", name: "Sibling discount", kind: "percent", value: 10, feeTypeId: "fee_tuition", description: "For the second and later child." },
      { id: "disc_staff", name: "Staff child", kind: "percent", value: 50, feeTypeId: "fee_tuition", description: "Children of permanent staff." },
      { id: "disc_merit", name: "Merit scholarship", kind: "percent", value: 25, feeTypeId: "fee_tuition", description: "Awarded on Grade 5 / O/L results." },
    ]),
    invoices: new Table(),
    payments: new Table(),
    payhereOrders: new Table(),
    reminders: new Map(),
    messages: new Table(),
    notices: new Table(),
    audit: new Table(),
    files: new Table(),
    studentDocuments: new Table(),
    counters: {},
  };

  // ---------- Fee structures ----------
  for (const g of db.grades.rows) {
    const add = (feeTypeId: string, amount: number) =>
      db.feeStructures.insert({ id: nextId(db, "fs"), yearId: "year_2026", gradeId: g.id, feeTypeId, amount });
    add("fee_tuition", TUITION[g.level]);
    add("fee_admission", 25000);
    add("fee_deposit", 10000);
    add("fee_exam", g.level === "al" ? 2000 : 1500);
    add("fee_sports", 2000);
  }

  // ---------- Staff ----------
  const users = db.users;
  const addStaff = (title: string, first: string, last: string, designation: string, email?: string) => {
    const id = nextId(db, "st");
    const s: Staff = {
      id, empNo: `EMP${String(db.counters.st).padStart(3, "0")}`, title, name: `${title} ${first} ${last}`,
      email: email ?? `${first}.${last}`.toLowerCase().replace(/\s+/g, "") + "@whizchool.lk",
      phone: phone(rng), designation, status: "active",
    };
    db.staff.insert(s);
    return s;
  };
  const addUser = (u: Omit<MockUser, "id" | "password"> & { id?: string }) => {
    const user: MockUser = { password: DEMO_PASSWORD, ...u, id: u.id ?? nextId(db, "usr") };
    users.insert(user);
    return user;
  };

  const principal = addStaff("Mrs.", "Anoma", "Wijesinghe", "Principal", "principal@whizchool.lk");
  const admin = addStaff("Ms.", "Nimali", "Perera", "Administrative Officer", "admin@whizchool.lk");
  const accountant = addStaff("Mr.", "Ruwan", "Jayasinghe", "Accountant", "accountant@whizchool.lk");
  const kasun = addStaff("Mr.", "Kasun", "Fernando", "Teacher – Mathematics", "teacher@whizchool.lk");
  const office = addStaff("Mrs.", "Gayani", "Herath", "Office Assistant");

  const specialists: Record<string, Staff[]> = { MAT: [kasun] };
  const usedNames = new Set<string>();
  const teacherName = (female: boolean) => {
    for (;;) {
      const first = female ? rng.pick(WOMEN) : rng.pick(MEN);
      const last = rng.pick(SURNAMES);
      if (!usedNames.has(first + last)) {
        usedNames.add(first + last);
        return { first, last };
      }
    }
  };
  for (const [code, count] of SPECIALISTS) {
    for (let i = 0; i < count; i++) {
      if (code === "MAT" && i === 0) continue;
      const female = rng.chance(0.65);
      const { first, last } = teacherName(female);
      const subjectName = CURRICULUM_SUBJECTS.find((s) => s.code === code)!.name;
      const t = addStaff(female ? rng.pick(["Mrs.", "Ms."]) : "Mr.", first, last, `Teacher – ${subjectName}`);
      (specialists[code] ??= []).push(t);
    }
  }
  const primaryTeachers: Staff[] = [];
  for (let i = 0; i < sectionsBelowAL.length * 5; i++) {
    const { first, last } = teacherName(true);
    primaryTeachers.push(addStaff(rng.pick(["Mrs.", "Ms."]), first, last, "Teacher – Primary"));
  }
  for (const [code, from] of Object.entries(SHARED_TEACHERS)) specialists[code] = specialists[from];

  // Staff user accounts
  const roleFor = (s: Staff): string[] => {
    if (s.id === principal.id) return ["role_principal"];
    if (s.id === admin.id) return ["role_admin"];
    if (s.id === accountant.id) return ["role_accountant"];
    if (s.id === office.id) return ["role_office"];
    return ["role_subject_teacher"];
  };
  for (const s of db.staff.rows) {
    const u = addUser({
      name: s.name, email: s.email, phone: s.phone, kind: "staff", status: "active", roleIds: roleFor(s),
      staffId: s.id, lastLoginAt: at(SEED_DATE, rng.int(7, 15), rng.int(0, 59)),
    });
    s.userId = u.id;
  }

  // ---------- Classes & subjects ----------
  const subjectId = (code: string) => `sub_${code.toLowerCase()}`;
  const load = new Map<string, number>();
  const assignTeacher = (code: string, gradeLevel: GradeLevel, classTeacher?: Staff) => {
    if (gradeLevel === "primary" && ["SIN", "MAT", "ENV", "ART"].includes(code)) return classTeacher?.id;
    const pool = specialists[code] ?? [];
    const t = [...pool].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
    if (t) load.set(t.id, (load.get(t.id) ?? 0) + 1);
    return t?.id;
  };

  const secondaryClassTeachers = db.staff.rows.filter(
    (s) => s.designation.startsWith("Teacher") && !s.designation.endsWith("Primary") && s.id !== kasun.id,
  );
  let ctIndex = 0;
  const makeClass = (yearId: string, grade: Grade, section: string, streamCode?: string) => {
    const id = `cls_${yearId.slice(5)}_${grade.number}${section.toLowerCase()}`;
    const c: ClassSection = {
      id, yearId, gradeId: grade.id, section, name: `${grade.number}-${section}`,
      streamId: streamCode ? `stream_${streamCode.toLowerCase()}` : undefined,
      room: `${grade.number <= 5 ? "P" : grade.number <= 11 ? "S" : "C"}${grade.number}${grade.number <= 11 ? section.slice(0, 1) : section}`,
    };
    return db.classes.insert(c);
  };

  for (const grade of db.grades.rows) {
    const sections = grade.level === "al" ? STREAMS.map(([code]) => code) : sectionsBelowAL;
    sections.forEach((section, i) => {
      const c = makeClass("year_2026", grade, section, grade.level === "al" ? section : undefined);
      let classTeacher: Staff | undefined;
      if (grade.level === "primary") classTeacher = primaryTeachers[(grade.number - 1) * sections.length + i];
      else if (grade.number === 10 && section === "A") classTeacher = kasun;
      else classTeacher = secondaryClassTeachers[ctIndex++ % secondaryClassTeachers.length];
      c.classTeacherId = classTeacher?.id;

      const codes =
        grade.level === "primary" ? PRIMARY_SUBJECTS
        : grade.level === "junior" ? JUNIOR_SUBJECTS
        : grade.level === "ol" ? [...OL_CORE, ...OL_BASKETS[1], ...OL_BASKETS[2], ...OL_BASKETS[3]]
        : STREAM_OFFERS[section]!;
      for (const code of codes) {
        let teacherId = assignTeacher(code, grade.level, classTeacher);
        if (code === "MAT" && (grade.number === 10 || grade.number === 11)) teacherId = kasun.id;
        const subject = db.subjects.get(subjectId(code))!;
        const optionGroup = optionGroupFor(grade.level, subject, { optional: (subject.optionalStreamIds ?? []).includes(c.streamId ?? "") }) ?? undefined;
        db.classSubjects.insert({ id: `cs_${c.id.slice(9)}_${code.toLowerCase()}`, classId: c.id, subjectId: subjectId(code), teacherId, optionGroup });
      }
    });
    // 2025 classes for history (one grade lower last year)
    if (grade.level !== "al") sectionsBelowAL.forEach((s) => makeClass("year_2025", grade, s));
    else STREAMS.forEach(([code]) => makeClass("year_2025", grade, code, code));
  }

  // class teachers get the class-teacher role too
  for (const c of db.classes.rows.filter((c) => c.yearId === "year_2026")) {
    const s = db.staff.get(c.classTeacherId);
    const u = users.get(s?.userId);
    if (u && !u.roleIds.includes("role_class_teacher")) u.roleIds.push("role_class_teacher");
  }

  // Each subject's teacher list: its specialists and whoever teaches it in a class (primary class teachers).
  for (const subject of db.subjects.rows) {
    const taught = db.classSubjects.rows.filter((cs) => cs.subjectId === subject.id).flatMap((cs) => (cs.teacherId ? [cs.teacherId] : []));
    subject.teacherIds = [...new Set([...(specialists[subject.code] ?? []).map((t) => t.id), ...taught])];
  }

  // ---------- Students & guardians ----------
  const classes2026 = db.classes.rows.filter((c) => c.yearId === "year_2026");
  let admissionSeq = 10850;
  let lastFamily: { surname: string; guardianId: string; count: number } | null = null;
  const families: { surname: string; guardianId: string; count: number }[] = [];

  // Emails are unique logins. Collisions get a suffix instead of a re-roll, so the random sequence
  // (and every name, id and mark generated after it) stays the same.
  const usedEmails = new Set<string>();
  const uniqueEmail = (email: string | undefined) => {
    if (!email) return undefined;
    let candidate = email;
    for (let n = 2; usedEmails.has(candidate); n++) candidate = email.replace("@", `.${n}@`);
    usedEmails.add(candidate);
    return candidate;
  };

  const makeGuardian = (surname: string, forceEmail?: string, forceName?: string, rel?: Guardian["relationship"]) => {
    const relationship = rel ?? (rng.chance(0.55) ? "Mother" : "Father");
    const first = relationship === "Mother" ? rng.pick(WOMEN) : rng.pick(MEN);
    const name = forceName ?? `${relationship === "Mother" ? "Mrs." : "Mr."} ${first} ${surname}`;
    const g: Guardian = {
      id: nextId(db, "gdn"), name, relationship, phone: phone(rng),
      email: uniqueEmail(forceEmail ?? (rng.chance(0.85) ? `${first}.${surname.replace(/\s+/g, "")}${rng.int(1, 99)}@gmail.com`.toLowerCase() : undefined)),
      nic: `${rng.int(196, 199)}${rng.int(1000000, 9999999)}V`,
      occupation: rng.pick(["Engineer", "Teacher", "Doctor", "Businessman", "Accountant", "Nurse", "Banker", "Government officer", "Lecturer", "Pharmacist", "Self-employed", "Homemaker"]),
      address: `${rng.int(3, 220)} ${rng.pick(STREETS)}, ${rng.pick(CITIES)}`,
    };
    return db.guardians.insert(g);
  };

  const makeStudent = (cls: ClassSection, opts: Partial<Student> & { guardianId?: string; surname?: string } = {}) => {
    const grade = db.grades.get(cls.gradeId)!;
    const gender = opts.gender ?? (rng.chance(0.5) ? "M" : "F");
    const firstName = opts.firstName ?? (gender === "M" ? rng.pick(BOY_NAMES) : rng.pick(GIRL_NAMES));
    let guardianId = opts.guardianId;
    let surname = opts.surname;
    if (!guardianId) {
      if (lastFamily && lastFamily.count < 2 && rng.chance(0.07)) {
        guardianId = lastFamily.guardianId;
        surname = lastFamily.surname;
        lastFamily.count++;
      } else {
        surname = rng.pick(SURNAMES);
        guardianId = makeGuardian(surname).id;
        lastFamily = { surname, guardianId, count: 1 };
        families.push(lastFamily);
      }
    }
    const age = grade.number + 5;
    const joinedYear = clamp(2026 - rng.int(0, grade.number - 1), 2014, 2026);
    const dob = iso(addDays(parseISO(`${2026 - age - 1}-01-01`), rng.int(0, 364)));
    const electives =
      grade.level === "ol"
        ? ([1, 2, 3] as const).map((b) => subjectId(rng.pick(OL_BASKETS[b])))
        : [];
    const s: Student = {
      id: nextId(db, "stu"), admissionNo: String(admissionSeq++), firstName, lastName: surname!,
      nameWithInitials: `${firstName[0]}. ${surname}`, gender, dob, classId: cls.id, gradeId: grade.id,
      status: "active", joinedDate: grade.number === 1 ? "2026-01-05" : `${joinedYear}-01-05`,
      address: db.guardians.get(guardianId)!.address ?? "",
      religion: rng.pick(["Buddhism", "Buddhism", "Buddhism", "Hinduism", "Islam", "Christianity"]),
      medical: rng.chance(0.15)
        ? { bloodGroup: rng.pick(["A+", "B+", "O+", "AB+", "O-"]), allergies: rng.pick(["Peanuts", "Dust", "Penicillin", "None known"]), conditions: rng.pick(["Asthma", "None", "Mild eczema"]) }
        : { bloodGroup: rng.pick(["A+", "B+", "O+", "AB+"]) },
      guardianIds: [guardianId],
      electiveSubjectIds: electives,
      discountIds: [],
      ...opts,
    } as Student;
    delete (s as Partial<Student> & { surname?: string; guardianId?: string }).guardianId;
    delete (s as Partial<Student> & { surname?: string }).surname;
    db.students.insert(s);
    db.enrollments.insert({ id: nextId(db, "enr"), studentId: s.id, yearId: "year_2026", classId: cls.id });
    if (grade.number > 1 && s.joinedDate < "2026-01-01") {
      const prev = db.classes.rows.find((c) => c.yearId === "year_2025" && c.gradeId === `grade_${grade.number - 1}` && (grade.level === "al" ? c.section === cls.section : true));
      if (prev) db.enrollments.insert({ id: nextId(db, "enr"), studentId: s.id, yearId: "year_2025", classId: prev.id });
    }
    return s;
  };

  // Demo family: Mrs. Dilani Perera with two children (10-A and 6-B)
  const demoGuardian = makeGuardian("Perera", "parent@whizchool.lk", "Mrs. Dilani Perera", "Mother");
  const cls10A = classes2026.find((c) => c.name === "10-A")!;
  const cls6B = classes2026.find((c) => c.name === "6-B")!;
  const kavindu = makeStudent(cls10A, { firstName: "Kavindu", gender: "M", guardianId: demoGuardian.id, surname: "Perera" });
  const nethmi = makeStudent(cls6B, { firstName: "Nethmi", gender: "F", guardianId: demoGuardian.id, surname: "Perera" });
  nethmi.discountIds = ["disc_sibling"];

  for (const cls of classes2026) {
    const grade = db.grades.get(cls.gradeId)!;
    const target = large ? (grade.level === "al" ? rng.int(20, 26) : rng.int(30, 34)) : grade.level === "al" ? rng.int(15, 20) : rng.int(22, 26);
    const existing = db.students.rows.filter((s) => s.classId === cls.id).length;
    for (let i = existing; i < target; i++) makeStudent(cls);
  }
  // sibling discounts & scholarships
  const byGuardian = new Map<string, Student[]>();
  for (const s of db.students.rows) byGuardian.set(s.guardianIds[0], [...(byGuardian.get(s.guardianIds[0]) ?? []), s]);
  for (const kids of byGuardian.values()) kids.slice(1).forEach((k) => !k.discountIds.includes("disc_sibling") && k.discountIds.push("disc_sibling"));
  for (const s of db.students.rows) {
    if (s.discountIds.length) continue;
    if (rng.chance(0.04)) s.discountIds.push("disc_merit");
    else if (rng.chance(0.02)) s.discountIds.push("disc_staff");
  }
  // a few students who left during the year
  for (const s of db.students.rows.filter((s) => s.id !== kavindu.id && s.id !== nethmi.id && rng.chance(0.012))) {
    s.status = "left";
    s.leftDate = iso(addDays(parseISO("2026-03-01"), rng.int(0, 180)));
    s.leftReason = rng.pick(["Moved abroad", "Transferred to another school", "Relocated to Colombo"]);
  }

  // Parent user accounts
  for (const g of db.guardians.rows) {
    if (!g.email) continue;
    const isDemo = g.id === demoGuardian.id;
    const active = isDemo || rng.chance(0.72);
    const u = addUser({
      name: g.name, email: g.email, phone: g.phone, kind: "parent", status: active ? "active" : "invited",
      roleIds: ["role_parent"], guardianId: g.id,
      invitedAt: at("2026-01-12", 9), lastLoginAt: active ? at(iso(addDays(parseISO(SEED_DATE), -rng.int(0, 30))), rng.int(6, 22), rng.int(0, 59)) : undefined,
    });
    g.userId = u.id;
  }
  db.tokens.set("demo-invite-token", { userId: users.rows.find((u) => u.status === "invited")!.id, kind: "invite" });
  db.tokens.set("demo-reset-token", { userId: users.rows.find((u) => u.email === "parent@whizchool.lk")!.id, kind: "reset" });

  // ---------- Marks ----------
  const ability = new Map<string, number>();
  const absentProne = new Map<string, number>();
  for (const s of db.students.rows) {
    ability.set(s.id, clamp(rng.normal(s.id === kavindu.id ? 74 : 60, 14), 22, 95));
    absentProne.set(s.id, clamp(rng.normal(0.045, 0.03), 0.005, 0.16));
  }
  // Choices besides the O/L baskets, without using random numbers: religion and language follow the student; A/L options take turns.
  const FAITH: Record<string, string> = { Buddhism: "BUD", Hinduism: "HIN", Islam: "ISL", Christianity: "CHR" };
  db.students.rows.forEach((s, index) => {
    const offered: OfferedSubject[] = db.classSubjects.rows.filter((cs) => cs.classId === s.classId);
    const level = db.grades.get(s.gradeId)!.level;
    if (level === "ol") s.electiveSubjectIds.push(subjectId(s.religion === "Hinduism" || s.religion === "Islam" ? "TML" : "SIN"), subjectId(FAITH[s.religion ?? ""] ?? "BUD"));
    if (level === "al") {
      const options = offered.filter((x) => x.optionGroup).map((x) => x.subjectId);
      const needed = db.streams.get(db.classes.get(s.classId)!.streamId)?.optionsRequired ?? 0;
      s.electiveSubjectIds = Array.from({ length: needed }, (_, i) => options[(index + i) % options.length]!);
    }
  });
  const subjectsFor = (s: Student) => db.classSubjects.rows.filter((cs) => cs.classId === s.classId && (!cs.optionGroup || s.electiveSubjectIds.includes(cs.subjectId)));
  const activeStudents = db.students.rows.filter((s) => s.status === "active");
  const enterMark = (examId: string, s: Student, subId: string, drift: number) => {
    const offset = (subId.charCodeAt(4) % 7) - 3;
    const m = rng.chance(0.02) ? "AB" : Math.round(clamp(rng.normal(ability.get(s.id)! + offset * 2 + drift, 7), 0, 100));
    db.marks.set(`${examId}|${s.id}|${subId}`, m);
  };
  for (const [examId, drift] of [["exam_2026_1", 0], ["exam_2026_2", 2]] as const) {
    for (const s of activeStudents) for (const cs of subjectsFor(s)) enterMark(examId, s, cs.subjectId, drift);
    for (const cs of db.classSubjects.rows) db.submittedSheets.add(`${examId}|${cs.classId}|${cs.subjectId}`);
    for (const c of classes2026) db.reportStatus.set(`${examId}|${c.id}`, "released");
  }
  // Term 3: partially entered
  for (const cs of db.classSubjects.rows) {
    const cls = db.classes.get(cs.classId)!;
    const roster = activeStudents.filter((s) => s.classId === cls.id && subjectsFor(s).some((x) => x.id === cs.id));
    const isKasun = cs.teacherId === kasun.id;
    const mode = isKasun
      ? cls.name === "10-A" ? "submitted" : cls.name === "10-B" ? "partial" : "empty"
      : rng.chance(0.58) ? "submitted" : rng.chance(0.45) ? "partial" : "empty";
    if (mode === "empty") continue;
    const share = mode === "submitted" ? 1 : 0.6;
    for (const s of roster) if (share === 1 || rng.chance(share)) enterMark("exam_2026_3", s, cs.subjectId, 3);
    if (mode === "submitted") db.submittedSheets.add(`exam_2026_3|${cs.classId}|${cs.subjectId}`);
  }
  // Remarks for released exams
  const remarkFor = (avg: number) =>
    avg >= 75 ? "Excellent performance. Keep up the great work!"
    : avg >= 60 ? "Good work. Continue to aim higher."
    : avg >= 45 ? "Satisfactory. Needs more consistent effort."
    : "Needs significant improvement. Please meet the class teacher.";
  for (const examId of ["exam_2026_1", "exam_2026_2"]) {
    for (const s of activeStudents) {
      const ms = subjectsFor(s).map((cs) => db.marks.get(`${examId}|${s.id}|${cs.subjectId}`)).filter((m) => m !== undefined);
      const avg = ms.reduce<number>((a, m) => a + (m === "AB" ? 0 : m), 0) / Math.max(1, ms.length);
      db.remarks.set(`${examId}|${s.id}`, { classTeacher: remarkFor(avg), principal: avg >= 75 ? "Commendable achievement." : undefined });
    }
  }

  // ---------- Attendance (Term 3 to date) ----------
  const days = schoolDays("2026-08-24", SEED_DATE);
  const unmarkedToday = new Set(["10-A", "7-B", "9-A", "12-COM"]);
  for (const c of classes2026) {
    const roster = activeStudents.filter((s) => s.classId === c.id);
    const teacher = db.staff.get(c.classTeacherId);
    for (const day of days) {
      if (day === SEED_DATE && unmarkedToday.has(c.name)) continue;
      const exceptions: Record<string, "absent" | "late" | "excused"> = {};
      for (const s of roster) {
        const p = absentProne.get(s.id)!;
        const r = rng.next();
        if (r < p) exceptions[s.id] = rng.chance(0.2) ? "excused" : "absent";
        else if (r < p + 0.02) exceptions[s.id] = "late";
      }
      db.attendance.set(`${c.id}|${day}`, { markedBy: teacher?.name ?? "Admin", markedAt: at(day, 7, rng.int(35, 59)), exceptions });
    }
  }

  // ---------- Invoices & payments ----------
  const tuitionFor = (s: Student) => db.feeStructures.rows.find((f) => f.gradeId === s.gradeId && f.feeTypeId === "fee_tuition")!.amount;
  const examFee = (s: Student) => db.feeStructures.rows.find((f) => f.gradeId === s.gradeId && f.feeTypeId === "fee_exam")!.amount;
  const behaviour = new Map<string, { kind: "prompt" | "late" | "defaulter"; stop: number }>();
  for (const [, kids] of byGuardian) {
    const r = rng.next();
    const b = r < 0.7 ? { kind: "prompt" as const, stop: 99 } : r < 0.88 ? { kind: "late" as const, stop: 99 } : { kind: "defaulter" as const, stop: rng.int(6, 9) };
    kids.forEach((k) => behaviour.set(k.id, b));
  }
  // Demo family: October left unpaid for one child so the online payment flow can be tried.
  behaviour.set(kavindu.id, { kind: "defaulter", stop: 10 });
  behaviour.set(nethmi.id, { kind: "prompt", stop: 10 });

  const pendingPayments: Omit<Payment, "id" | "receiptNo">[] = [];
  const methodPick = (): PaymentMethod => {
    const r = rng.next();
    return r < 0.4 ? "bank_deposit" : r < 0.7 ? "payhere" : r < 0.95 ? "cash" : "cheque";
  };
  for (const s of db.students.rows) {
    const lastMonth = s.status === "left" && s.leftDate ? Number(s.leftDate.slice(5, 7)) : 10;
    const discount = s.discountIds.map((d) => db.discounts.get(d)!).reduce((a, d) => a + (d.kind === "percent" ? d.value : 0), 0);
    for (let m = 1; m <= lastMonth; m++) {
      const mm = String(m).padStart(2, "0");
      const period = `2026-${mm}`;
      const lines: InvoiceLine[] = [];
      const tuition = tuitionFor(s);
      lines.push({ id: `l${m}a`, feeTypeId: "fee_tuition", description: `Tuition fee – ${format(parseISO(`${period}-01`), "MMMM yyyy")}`, amount: tuition, discount: Math.round((tuition * discount) / 100) });
      if (m === 1 && s.joinedDate >= "2026-01-01") {
        lines.push({ id: "l1b", feeTypeId: "fee_admission", description: "Admission fee", amount: 25000, discount: 0 });
        lines.push({ id: "l1c", feeTypeId: "fee_deposit", description: "Refundable deposit", amount: 10000, discount: 0 });
      }
      if (m === 2) lines.push({ id: "l2b", feeTypeId: "fee_sports", description: "Annual sports meet", amount: 2000, discount: 0 });
      if (m === 3 || m === 7 || m === 10) lines.push({ id: `l${m}e`, feeTypeId: "fee_exam", description: `Term ${m === 3 ? 1 : m === 7 ? 2 : 3} test fee`, amount: examFee(s), discount: 0 });
      const total = lines.reduce((a, l) => a + l.amount - l.discount, 0);
      const inv: Invoice = {
        id: nextId(db, "inv"), number: `INV-2026-${String(nextNumber(db, "invoiceNo")).padStart(6, "0")}`,
        studentId: s.id, period, issueDate: `${period}-01`, dueDate: `${period}-10`, lines, total, paid: 0, balance: total, status: "unpaid",
      };
      db.invoices.insert(inv);

      const b = behaviour.get(s.id)!;
      if (b.kind === "defaulter" && m >= b.stop) continue;
      const due = parseISO(inv.dueDate);
      const payDate = b.kind === "prompt" ? addDays(parseISO(inv.issueDate), rng.int(1, 9)) : addDays(due, rng.int(4, 32));
      if (iso(payDate) > SEED_DATE) continue;
      const method = methodPick();
      const partial = b.kind === "late" && rng.chance(0.08);
      const amount = partial ? Math.round(total / 2) : total;
      pendingPayments.push({
        studentId: s.id, amount, method, status: "completed",
        reference: method === "bank_deposit" ? `BOC-${rng.int(100000, 999999)}` : method === "payhere" ? `PH-${rng.int(320000000, 329999999)}` : method === "cheque" ? `CHQ ${rng.int(100000, 999999)}` : undefined,
        paidAt: at(iso(payDate), rng.int(8, 16), rng.int(0, 59)),
        recordedBy: method === "payhere" ? "PayHere (online)" : accountant.name,
        allocations: [{ invoiceId: inv.id, invoiceNumber: inv.number, amount }],
      });
    }
  }
  pendingPayments.sort((a, b) => a.paidAt.localeCompare(b.paidAt));
  for (const p of pendingPayments) {
    const payment: Payment = { ...p, id: nextId(db, "pay"), receiptNo: `RCT-2026-${String(nextNumber(db, "receiptNo")).padStart(6, "0")}` };
    db.payments.insert(payment);
    for (const a of payment.allocations) {
      const inv = db.invoices.get(a.invoiceId)!;
      inv.paid += a.amount;
      inv.balance = inv.total - inv.paid;
      inv.status = inv.balance <= 0 ? "paid" : "partial";
    }
  }

  // ---------- Admissions ----------
  const stages = ["new", "new", "new", "new", "new", "new", "new", "new", "new", "interview", "interview", "interview", "interview", "interview", "interview", "interview", "accepted", "accepted", "accepted", "accepted", "accepted", "rejected", "rejected", "rejected", "withdrawn"] as const;
  stages.forEach((stage, i) => {
    const gender = rng.chance(0.5) ? "M" : "F";
    const first = gender === "M" ? rng.pick(BOY_NAMES) : rng.pick(GIRL_NAMES);
    const surname = rng.pick(SURNAMES);
    const gradeNo = rng.pick([1, 1, 1, 2, 3, 4, 6, 6, 7, 8, 9, 10, 12, 12]);
    const parentRel = rng.chance(0.5) ? "Mother" : "Father";
    const parentFirst = parentRel === "Mother" ? rng.pick(WOMEN) : rng.pick(MEN);
    const submitted = addDays(parseISO("2026-09-01"), rng.int(0, 50));
    const submittedAt = at(iso(submitted), rng.int(7, 21), rng.int(0, 59));
    const timeline: { stage: (typeof stages)[number]; at: string; by: string; note?: string }[] = [{ stage: "new", at: submittedAt, by: "Online form" }];
    let interviewAt: string | undefined;
    if (stage !== "new") {
      const reviewed = iso(addDays(submitted, rng.int(1, 4)));
      if (stage !== "withdrawn") {
        interviewAt = at(iso(addDays(submitted, rng.int(6, 14))), rng.pick([9, 10, 11, 14]));
        timeline.push({ stage: "interview", at: at(reviewed, 10), by: admin.name, note: "Interview and placement test scheduled." });
      }
      if (stage === "accepted" || stage === "rejected") timeline.push({ stage, at: at(iso(addDays(submitted, rng.int(15, 20))), 15), by: principal.name, note: stage === "accepted" ? "Offer made." : "Seats are full for this grade." });
      if (stage === "withdrawn") timeline.push({ stage, at: at(reviewed, 11), by: admin.name, note: "Parent withdrew the application." });
    }
    db.applications.insert({
      id: nextId(db, "app"), refNo: `APP-2026-${String(301 + i).padStart(4, "0")}`, stage, submittedAt, interviewAt,
      applyingGradeId: `grade_${gradeNo}`,
      student: {
        firstName: first, lastName: surname, gender, dob: iso(addDays(parseISO(`${2026 - gradeNo - 6}-01-01`), rng.int(0, 364))),
        religion: rng.pick(["Buddhism", "Hinduism", "Islam", "Christianity"]),
        address: `${rng.int(3, 220)} ${rng.pick(STREETS)}, ${rng.pick(CITIES)}`,
        previousSchool: gradeNo > 1 ? rng.pick(["Kingswood Primary", "St. Anne's Vidyalaya", "Hillside Montessori", "Lakeview College", "Sri Rahula Vidyalaya"]) : undefined,
      },
      guardian: {
        name: `${parentRel === "Mother" ? "Mrs." : "Mr."} ${parentFirst} ${surname}`, relationship: parentRel, phone: phone(rng),
        email: `${parentFirst}.${surname}`.toLowerCase().replace(/\s+/g, "") + "@gmail.com",
        nic: `${rng.int(196, 199)}${rng.int(1000000, 9999999)}V`, occupation: rng.pick(["Engineer", "Teacher", "Banker", "Doctor", "Business owner"]),
      },
      documents: [
        { name: "birth-certificate.pdf", size: rng.int(180, 900) * 1024, kind: "birth_certificate" },
        { name: "photo.jpg", size: rng.int(120, 600) * 1024, kind: "photo" },
        ...(gradeNo > 1 ? [{ name: "previous-report.pdf", size: rng.int(200, 1200) * 1024, kind: "report" as const }] : []),
      ],
      timeline,
    });
  });

  // ---------- Messages, notices, audit ----------
  for (const day of days.slice(-12)) {
    const absent = [...db.attendance.entries()].filter(([k]) => k.endsWith(day)).reduce((a, [, v]) => a + Object.values(v.exceptions).filter((x) => x === "absent").length, 0);
    db.messages.insert({
      id: nextId(db, "msg"), channel: "sms", kind: "absence_alert",
      audience: { type: "class", label: "Parents of absent students" },
      body: "Dear parent, {student} was marked absent today ({date}). Please contact the class teacher if this is unexpected. – Whizchool Demo College",
      recipients: absent, delivered: Math.max(0, absent - rng.int(0, 2)), failed: 0, status: "sent",
      createdAt: at(day, 9, rng.int(0, 30)), createdBy: "System",
    });
  }
  const manual: [string, string, "sms" | "email", string, number][] = [
    ["2026-09-02", "all_parents", "sms", "Term 3 begins. School starts at 7.30 a.m. Please ensure punctual arrival.", 640],
    ["2026-09-18", "grade", "email", "Grade 11 O/L seminar series: Saturdays 8.00–11.00 a.m. in the main hall.", 48],
    ["2026-10-05", "defaulters", "sms", "Reminder: school fees for {month} are overdue. Please settle at the earliest. Ignore if already paid.", 74],
    ["2026-10-09", "all_parents", "email", "Term 3 test timetable is attached. Tests run 12–21 October.", 600],
    ["2026-10-20", "all_staff", "email", "Term 3 marks entry closes on 30 October. Please submit all mark sheets.", 58],
  ];
  for (const [date, type, channel, body, recipients] of manual) {
    db.messages.insert({
      id: nextId(db, "msg"), channel, kind: type === "defaulters" ? "fee_reminder" : "manual",
      audience: { type: type as "all_parents", label: type === "all_parents" ? "All parents" : type === "grade" ? "Grade 11 parents" : type === "defaulters" ? "Parents with overdue fees" : "All staff" },
      subject: channel === "email" ? body.split(".")[0] : undefined, body, recipients,
      delivered: recipients - rng.int(0, 6), failed: rng.int(0, 3), status: "sent", createdAt: at(date, 10, 15),
      createdBy: type === "defaulters" ? accountant.name : admin.name,
    });
  }
  const notices: [string, string, "everyone" | "parents" | "staff", boolean, string][] = [
    ["Term 3 test results", "Term 3 test results will be released through the parent portal in the second week of November.", "parents", true, "2026-10-22"],
    ["Prize giving 2026", "The annual prize giving will be held on 28 November at 3.00 p.m. in the main hall. Parents of award winners will be informed individually.", "everyone", false, "2026-10-15"],
    ["Marks entry deadline", "All Term 3 mark sheets must be submitted by 30 October so report cards can be approved on time.", "staff", true, "2026-10-20"],
    ["Deepavali holiday", "The school will be closed on 8 November for Deepavali.", "everyone", false, "2026-10-12"],
    ["Fee payments online", "You can now pay school fees online with card or eZ Cash through the parent portal (PayHere).", "parents", false, "2026-09-05"],
  ];
  for (const [title, body, audience, pinned, date] of notices) {
    db.notices.insert({ id: nextId(db, "ntc"), title, body, audience, pinned, publishedAt: at(date, 9), author: audience === "staff" ? principal.name : admin.name });
  }
  const auditSeed: [string, string, string, string, string][] = [
    [admin.name, "settings.update", "School", "Updated SMS sender ID", "2026-09-01"],
    [accountant.name, "invoice.generate", "Invoice", "Generated October tuition invoices (652)", "2026-10-01"],
    [principal.name, "reportCards.release", "Report cards", "Released Term 2 Test 2026 report cards for all classes", "2026-08-28"],
    [admin.name, "user.invite", "User", "Invited 18 parents", "2026-09-10"],
    [kasun.name, "marks.submit", "Mark sheet", "Submitted Mathematics marks for 10-A (Term 3)", "2026-10-22"],
    [accountant.name, "payment.record", "Payment", "Recorded cash payment RCT for 10-B student", "2026-10-21"],
    [admin.name, "application.transition", "Application", "Moved APP-2026-0310 to interview", "2026-10-02"],
    [principal.name, "application.accept", "Application", "Accepted APP-2026-0317", "2026-10-14"],
    [admin.name, "role.update", "Role", "Updated permissions for Office Staff", "2026-09-03"],
    [accountant.name, "fees.reminder", "Message", "Sent overdue reminders to 74 parents", "2026-10-05"],
  ];
  for (const [actor, action, entity, summary, date] of auditSeed) {
    db.audit.insert({ id: nextId(db, "aud"), at: at(date, rng.int(8, 17), rng.int(0, 59)), actor, action, entity, summary });
  }
  db.audit.rows.sort((a, b) => b.at.localeCompare(a.at));

  seedTimetables(db, classes2026);
  return db;
}
