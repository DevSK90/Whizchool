// In-memory data store for the mock backend. Shapes mirror the planned Prisma schema.
import type {
  AcademicYear,
  Application,
  AttendanceStatus,
  AuditEntry,
  ClassSection,
  ClassSubject,
  Discount,
  Exam,
  FeeStructure,
  FeeType,
  Grade,
  GradeBand,
  Guardian,
  Invoice,
  MessageLog,
  Notice,
  Payment,
  ReportCardStatus,
  Role,
  School,
  Staff,
  Stream,
  Student,
  Subject,
  Term,
  User,
} from "../types";

export class Table<T extends { id: string }> {
  private map = new Map<string, T>();
  rows: T[] = [];

  constructor(rows: T[] = []) {
    rows.forEach((r) => this.insert(r));
  }
  insert(row: T) {
    this.rows.push(row);
    this.map.set(row.id, row);
    return row;
  }
  get(id: string | undefined) {
    return id ? this.map.get(id) : undefined;
  }
  remove(id: string) {
    this.rows = this.rows.filter((r) => r.id !== id);
    this.map.delete(id);
  }
  get size() {
    return this.rows.length;
  }
}

export type MockUser = User & { password: string };

export interface AttendanceDay {
  markedBy: string;
  markedAt: string;
  /** Only non-present statuses are stored */
  exceptions: Record<string, AttendanceStatus>;
}

export interface Enrollment {
  id: string;
  studentId: string;
  yearId: string;
  classId: string;
}

export interface MockFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  purpose: string;
  /** Downscaled image preview (data URL); PDFs keep metadata only in the demo. */
  dataUrl?: string;
  uploadedAt: string;
}

export interface MockStudentDocument {
  id: string;
  studentId: string;
  fileId: string;
  kind: "birth_certificate" | "photo" | "report" | "medical" | "other";
  uploadedAt: string;
  uploadedBy: string;
}

export interface PayHereOrder {
  id: string;
  studentId: string;
  invoiceIds: string[];
  amount: number;
  status: "pending" | "success" | "failed" | "cancelled";
  createdAt: string;
}

export interface DB {
  school: School;
  years: Table<AcademicYear>;
  terms: Table<Term>;
  grades: Table<Grade>;
  streams: Table<Stream>;
  classes: Table<ClassSection>;
  subjects: Table<Subject>;
  classSubjects: Table<ClassSubject>;
  gradeBands: GradeBand[];
  staff: Table<Staff>;
  guardians: Table<Guardian>;
  students: Table<Student>;
  enrollments: Table<Enrollment>;
  users: Table<MockUser>;
  roles: Table<Role>;
  tokens: Map<string, { userId: string; kind: "invite" | "reset" }>;
  applications: Table<Application>;
  /** key: `${classId}|${date}` */
  attendance: Map<string, AttendanceDay>;
  exams: Table<Exam>;
  /** key: `${examId}|${studentId}|${subjectId}` */
  marks: Map<string, number | "AB">;
  /** key: `${examId}|${classId}|${subjectId}` */
  submittedSheets: Set<string>;
  /** key: `${examId}|${classId}` — approval workflow state beyond computed "pending/draft" */
  reportStatus: Map<string, Extract<ReportCardStatus, "approved" | "released">>;
  /** key: `${examId}|${studentId}` */
  remarks: Map<string, { classTeacher?: string; principal?: string }>;
  feeTypes: Table<FeeType>;
  feeStructures: Table<FeeStructure>;
  discounts: Table<Discount>;
  invoices: Table<Invoice>;
  payments: Table<Payment>;
  payhereOrders: Table<PayHereOrder>;
  reminders: Map<string, string>;
  messages: Table<MessageLog>;
  notices: Table<Notice>;
  audit: Table<AuditEntry>;
  files: Table<MockFile>;
  studentDocuments: Table<MockStudentDocument>;
  counters: Record<string, number>;
  promotionSummary?: { at: string; promoted: number; repeated: number; left: number; graduated: number };
}

export function nextId(db: DB, prefix: string) {
  db.counters[prefix] = (db.counters[prefix] ?? 0) + 1;
  return `${prefix}_${String(db.counters[prefix]).padStart(4, "0")}`;
}

export function nextNumber(db: DB, key: string, start = 1) {
  db.counters[key] = (db.counters[key] ?? start - 1) + 1;
  return db.counters[key];
}
