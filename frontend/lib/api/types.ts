// Domain types for the Whizchool REST API (/api/v1).
// These mirror the planned Prisma models and will move to packages/shared with the backend.
import type { DataScope, PermissionKey } from "@/lib/permissions";

export type ID = string;
/** ISO date (yyyy-mm-dd) */
export type DateString = string;
/** ISO timestamp */
export type DateTimeString = string;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: string;
}

// ---------- Auth & users ----------

export type UserKind = "staff" | "parent";
export type UserStatus = "invited" | "active" | "deactivated";

export interface Role {
  id: ID;
  name: string;
  description: string;
  system: boolean;
  scope: DataScope;
  permissions: PermissionKey[];
  userCount?: number;
}

export interface User {
  id: ID;
  name: string;
  email: string;
  phone?: string;
  kind: UserKind;
  status: UserStatus;
  roleIds: ID[];
  staffId?: ID;
  guardianId?: ID;
  lastLoginAt?: DateTimeString;
  invitedAt?: DateTimeString;
}

export interface SessionUser {
  id: ID;
  name: string;
  email: string;
  kind: UserKind;
  roles: { id: ID; name: string; scope: DataScope }[];
  permissions: PermissionKey[];
  /** Classes this user is class teacher of (own_class scope) */
  classIds: ID[];
  /** Class-subject assignments taught (own_subjects scope) */
  classSubjectIds: ID[];
  /** Children linked to this parent (own_children scope) */
  studentIds: ID[];
}

// ---------- School structure ----------

export type GradeLevel = "primary" | "junior" | "ol" | "al";

export interface School {
  name: string;
  shortName: string;
  motto: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  principalName: string;
  currency: "LKR";
  timezone: string;
  currentYearId: ID;
  logoUrl?: string;
  smsSenderId: string;
}

export interface AcademicYear {
  id: ID;
  name: string;
  startDate: DateString;
  endDate: DateString;
  status: "upcoming" | "active" | "closed";
}

export interface Term {
  id: ID;
  yearId: ID;
  number: 1 | 2 | 3;
  name: string;
  startDate: DateString;
  endDate: DateString;
}

export interface Grade {
  id: ID;
  number: number;
  name: string;
  level: GradeLevel;
}

export interface Stream {
  id: ID;
  name: string;
  code: string;
}

export interface ClassSection {
  id: ID;
  yearId: ID;
  gradeId: ID;
  section: string;
  name: string;
  streamId?: ID;
  classTeacherId?: ID;
  room?: string;
}

export interface ClassSummary extends ClassSection {
  gradeName: string;
  gradeNumber: number;
  streamName?: string;
  classTeacherName?: string;
  studentCount: number;
}

export interface Subject {
  id: ID;
  name: string;
  code: string;
  levels: GradeLevel[];
  /** O/L basket number for electives (1-3); undefined = core */
  basket?: 1 | 2 | 3;
  streamIds?: ID[];
}

export interface ClassSubject {
  id: ID;
  classId: ID;
  subjectId: ID;
  teacherId?: ID;
}

export interface ClassDetail extends ClassSummary {
  subjects: (ClassSubject & { subjectName: string; teacherName?: string })[];
  students: StudentListItem[];
}

export interface GradeBand {
  grade: string;
  min: number;
  max: number;
  label: string;
  pass: boolean;
}

// ---------- People ----------

export interface Staff {
  id: ID;
  empNo: string;
  title: string;
  name: string;
  email: string;
  phone: string;
  designation: string;
  userId?: ID;
  status: "active" | "inactive";
}

export interface Guardian {
  id: ID;
  name: string;
  relationship: "Father" | "Mother" | "Guardian";
  phone: string;
  email?: string;
  nic?: string;
  occupation?: string;
  address?: string;
  userId?: ID;
}

export type StudentStatus = "active" | "left" | "graduated" | "expelled";
export type Gender = "M" | "F";

export interface Student {
  id: ID;
  admissionNo: string;
  firstName: string;
  lastName: string;
  nameWithInitials: string;
  gender: Gender;
  dob: DateString;
  classId: ID;
  gradeId: ID;
  status: StudentStatus;
  joinedDate: DateString;
  leftDate?: DateString;
  leftReason?: string;
  address: string;
  religion?: string;
  medical?: { bloodGroup?: string; allergies?: string; conditions?: string };
  guardianIds: ID[];
  electiveSubjectIds: ID[];
  discountIds: ID[];
}

export interface StudentListItem {
  id: ID;
  admissionNo: string;
  fullName: string;
  gender: Gender;
  className: string;
  classId: ID;
  gradeId: ID;
  status: StudentStatus;
  primaryGuardian?: string;
  guardianPhone?: string;
  balance: number;
}

export interface StudentDetail extends Student {
  fullName: string;
  className: string;
  gradeName: string;
  streamName?: string;
  guardians: Guardian[];
  subjects: { id: ID; name: string }[];
  discounts: Discount[];
  attendanceRate: number;
  balance: number;
  history: { yearName: string; className: string }[];
}

// ---------- Admissions ----------

export type ApplicationStage =
  | "new"
  | "interview"
  | "accepted"
  | "rejected"
  | "enrolled"
  | "withdrawn";

export interface ApplicationInput {
  applyingGradeId: ID;
  student: {
    firstName: string;
    lastName: string;
    gender: Gender;
    dob: DateString;
    religion?: string;
    address: string;
    previousSchool?: string;
    medicalNotes?: string;
  };
  guardian: {
    name: string;
    relationship: Guardian["relationship"];
    phone: string;
    email: string;
    nic?: string;
    occupation?: string;
  };
  documents: { name: string; size: number; kind: "birth_certificate" | "report" | "photo" | "other" }[];
}

export interface Application extends ApplicationInput {
  id: ID;
  refNo: string;
  stage: ApplicationStage;
  submittedAt: DateTimeString;
  interviewAt?: DateTimeString;
  enrolledStudentId?: ID;
  timeline: { stage: ApplicationStage; at: DateTimeString; by: string; note?: string }[];
}

export interface ApplicationListItem {
  id: ID;
  refNo: string;
  studentName: string;
  gradeName: string;
  guardianName: string;
  guardianPhone: string;
  stage: ApplicationStage;
  submittedAt: DateTimeString;
  interviewAt?: DateTimeString;
}

export interface ApplicationStatusView {
  refNo: string;
  studentName: string;
  gradeName: string;
  stage: ApplicationStage;
  submittedAt: DateTimeString;
  interviewAt?: DateTimeString;
  timeline: { stage: ApplicationStage; at: DateTimeString }[];
}

// ---------- Attendance ----------

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

export interface AttendanceSheet {
  classId: ID;
  className: string;
  date: DateString;
  marked: boolean;
  markedBy?: string;
  markedAt?: DateTimeString;
  records: { studentId: ID; admissionNo: string; fullName: string; status: AttendanceStatus }[];
}

export interface AttendanceDaySummary {
  date: DateString;
  classes: {
    classId: ID;
    className: string;
    classTeacherName?: string;
    marked: boolean;
    present: number;
    absent: number;
    late: number;
    total: number;
  }[];
}

export interface StudentAttendance {
  rate: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  days: { date: DateString; status: AttendanceStatus }[];
}

// ---------- Exams & results ----------

export type ExamStatus = "scheduled" | "marks_entry" | "review" | "released";

export interface Exam {
  id: ID;
  yearId: ID;
  termId: ID;
  name: string;
  termName: string;
  status: ExamStatus;
  startDate: DateString;
  endDate: DateString;
}

export interface ExamProgress {
  exam: Exam;
  sheets: {
    classId: ID;
    className: string;
    gradeNumber: number;
    subjectId: ID;
    subjectName: string;
    teacherName?: string;
    entered: number;
    total: number;
    submitted: boolean;
  }[];
}

export type MarkValue = number | "AB" | null;

export interface MarkSheet {
  examId: ID;
  classId: ID;
  className: string;
  subjectId: ID;
  subjectName: string;
  submitted: boolean;
  editable: boolean;
  rows: { studentId: ID; admissionNo: string; fullName: string; mark: MarkValue }[];
}

export type ReportCardStatus = "pending_marks" | "draft" | "approved" | "released";

export interface ReportCardSummary {
  examId: ID;
  studentId: ID;
  admissionNo: string;
  fullName: string;
  total: number;
  average: number;
  rank: number;
  classSize: number;
  grades: Record<string, number>;
  status: ReportCardStatus;
  hasRemark: boolean;
}

export interface ReportCardClassView {
  exam: Exam;
  classId: ID;
  className: string;
  status: ReportCardStatus;
  marksComplete: boolean;
  rows: ReportCardSummary[];
}

export interface ReportCard {
  exam: Exam;
  school: Pick<School, "name" | "motto" | "address" | "phone" | "principalName">;
  student: { id: ID; admissionNo: string; fullName: string; classId: ID; className: string; gradeName: string };
  status: ReportCardStatus;
  subjects: { subjectId: ID; name: string; mark: MarkValue; grade: string; classAverage: number }[];
  total: number;
  average: number;
  rank: number;
  classSize: number;
  attendance: { present: number; total: number };
  classTeacherRemark?: string;
  principalRemark?: string;
  classTeacherName?: string;
}

export interface StudentResults {
  exams: {
    exam: Exam;
    released: boolean;
    average?: number;
    rank?: number;
    classSize?: number;
    subjects?: { name: string; mark: MarkValue; grade: string }[];
  }[];
}

// ---------- Promotions ----------

export type PromotionAction = "promote" | "repeat" | "leave" | "graduate";

export interface PromotionRow {
  studentId: ID;
  admissionNo: string;
  fullName: string;
  fromClassId: ID;
  fromClassName: string;
  average?: number;
  action: PromotionAction;
  toClassId?: ID;
}

export interface PromotionPreview {
  fromYear: AcademicYear;
  toYearName: string;
  rows: PromotionRow[];
  targetClasses: { id: ID; name: string; gradeNumber: number }[];
  completed?: PromotionSummary;
}

export interface PromotionSummary {
  at: DateTimeString;
  promoted: number;
  repeated: number;
  left: number;
  graduated: number;
}

export interface ReportCardOverviewRow {
  classId: ID;
  className: string;
  gradeNumber: number;
  classTeacherName?: string;
  status: ReportCardStatus;
  sheetsSubmitted: number;
  sheetsTotal: number;
  students: number;
}

// ---------- Fees ----------

export type FeeRecurrence = "monthly" | "one_time" | "ad_hoc";

export interface FeeType {
  id: ID;
  name: string;
  recurrence: FeeRecurrence;
  description?: string;
  active: boolean;
}

export interface FeeStructure {
  id: ID;
  yearId: ID;
  gradeId: ID;
  feeTypeId: ID;
  amount: number;
}

export interface Discount {
  id: ID;
  name: string;
  kind: "percent" | "fixed";
  value: number;
  feeTypeId?: ID;
  description?: string;
}

export type InvoiceStatus = "unpaid" | "partial" | "paid" | "void";

export interface InvoiceLine {
  id: ID;
  feeTypeId: ID;
  description: string;
  amount: number;
  discount: number;
}

export interface Invoice {
  id: ID;
  number: string;
  studentId: ID;
  period?: string;
  issueDate: DateString;
  dueDate: DateString;
  lines: InvoiceLine[];
  total: number;
  paid: number;
  balance: number;
  status: InvoiceStatus;
}

export interface InvoiceListItem extends Invoice {
  studentName: string;
  admissionNo: string;
  className: string;
  overdue: boolean;
}

export type PaymentMethod = "cash" | "cheque" | "bank_deposit" | "payhere";
export type PaymentStatus = "completed" | "pending" | "failed" | "reversed";

export interface Payment {
  id: ID;
  receiptNo: string;
  studentId: ID;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  paidAt: DateTimeString;
  recordedBy: string;
  status: PaymentStatus;
  allocations: { invoiceId: ID; invoiceNumber: string; amount: number }[];
}

export interface PaymentListItem extends Payment {
  studentName: string;
  admissionNo: string;
  className: string;
}

export interface InvoiceDetail extends InvoiceListItem {
  payments: Payment[];
  guardianName?: string;
}

export interface FeesSummary {
  collectedThisMonth: number;
  collectedLastMonth: number;
  outstanding: number;
  overdueInvoices: number;
  defaulters: number;
  monthly: { month: string; label: string; billed: number; collected: number }[];
  byMethod: { method: PaymentMethod; amount: number }[];
}

export interface Defaulter {
  studentId: ID;
  admissionNo: string;
  fullName: string;
  className: string;
  guardianName?: string;
  guardianPhone?: string;
  overdueInvoices: number;
  balance: number;
  oldestDueDate: DateString;
  lastReminderAt?: DateTimeString;
}

export interface PayHereCheckout {
  orderId: string;
  amount: number;
  currency: "LKR";
  actionUrl: string;
  fields: Record<string, string>;
}

// ---------- Communication ----------

export type MessageChannel = "sms" | "email";
export type AudienceType = "all_parents" | "grade" | "class" | "all_staff" | "defaulters";

export interface MessageLog {
  id: ID;
  channel: MessageChannel;
  audience: { type: AudienceType; ids?: ID[]; label: string };
  subject?: string;
  body: string;
  recipients: number;
  delivered: number;
  failed: number;
  status: "queued" | "sending" | "sent" | "partial" | "failed";
  createdAt: DateTimeString;
  createdBy: string;
  kind: "manual" | "absence_alert" | "fee_reminder" | "system";
}

export interface Notice {
  id: ID;
  title: string;
  body: string;
  audience: "everyone" | "parents" | "staff";
  pinned: boolean;
  publishedAt: DateTimeString;
  author: string;
}

// ---------- Platform ----------

export interface AuditEntry {
  id: ID;
  at: DateTimeString;
  actor: string;
  action: string;
  entity: string;
  entityId?: ID;
  summary: string;
}

export interface ImportRow {
  admissionNo?: string;
  firstName: string;
  lastName: string;
  gender: string;
  dob: string;
  className: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail?: string;
  address?: string;
}

export interface ImportPreview {
  rows: { index: number; data: ImportRow; errors: string[]; warnings: string[] }[];
  valid: number;
  invalid: number;
}

// ---------- Dashboards ----------

export interface StaffDashboard {
  activeStudents: number;
  newStudentsThisYear: number;
  staffCount: number;
  attendanceToday: { rate: number; marked: number; totalClasses: number };
  pendingApplications: number;
  fees: { collectedThisMonth: number; outstanding: number };
  attendanceTrend: { date: DateString; rate: number }[];
  feesMonthly: { month: string; label: string; collected: number; billed: number }[];
  pendingReportCards: { examId: ID; examName: string; classId: ID; className: string; status: ReportCardStatus }[];
  recentApplications: ApplicationListItem[];
  enrollmentByLevel: { level: GradeLevel; label: string; count: number }[];
}

export interface PortalChild {
  id: ID;
  fullName: string;
  admissionNo: string;
  className: string;
  attendanceRate: number;
  latestAverage?: number;
  latestExamName?: string;
  latestRank?: number;
  classSize?: number;
  balance: number;
  overdue: number;
}
