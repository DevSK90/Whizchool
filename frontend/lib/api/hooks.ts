"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage, type QueryParams } from "./client";
import type * as T from "./types";

type Params = QueryParams;

// ---------- generic mutation helper ----------

export function useApiMutation<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: {
    invalidate?: QueryKey[];
    success?: string | ((result: TResult, vars: TVars) => string | undefined);
    /** Set false when the caller renders the error itself (e.g. form field errors). */
    toastError?: boolean;
    onSuccess?: (result: TResult, vars: TVars) => void;
  } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result, vars) => {
      await Promise.all((opts.invalidate ?? []).map((queryKey) => qc.invalidateQueries({ queryKey })));
      const msg = typeof opts.success === "function" ? opts.success(result, vars) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(result, vars);
    },
    onError: (error) => {
      if (opts.toastError !== false) toast.error(errorMessage(error));
    },
  });
}

// ---------- auth ----------

export const useMe = () =>
  useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<T.SessionUser>("/auth/me"),
    retry: false,
    staleTime: 5 * 60_000,
  });

// ---------- school structure ----------

const LONG = 10 * 60_000;

export const usePublicSchool = () =>
  useQuery({
    queryKey: ["publicSchool"],
    queryFn: () => api.get<Pick<T.School, "name" | "shortName" | "motto" | "address" | "phone" | "email" | "website">>("/public/school"),
    staleTime: LONG,
  });
export const useSchool = () => useQuery({ queryKey: ["school"], queryFn: () => api.get<T.School>("/settings/school"), staleTime: LONG });
export const useYears = () => useQuery({ queryKey: ["years"], queryFn: () => api.get<T.AcademicYear[]>("/academic-years"), staleTime: LONG });
export const useTerms = (yearId?: string) =>
  useQuery({ queryKey: ["terms", yearId ?? "current"], queryFn: () => api.get<T.Term[]>("/terms", { yearId }), staleTime: LONG });
export const useGrades = () => useQuery({ queryKey: ["grades"], queryFn: () => api.get<T.Grade[]>("/grades"), staleTime: LONG });
export const useStreams = () => useQuery({ queryKey: ["streams"], queryFn: () => api.get<T.Stream[]>("/streams"), staleTime: LONG });
export const useClasses = (yearId?: string) =>
  useQuery({ queryKey: ["classes", yearId ?? "current"], queryFn: () => api.get<T.ClassSummary[]>("/classes", { yearId }), staleTime: 60_000 });
export const useClass = (id: string) =>
  useQuery({ queryKey: ["class", id], queryFn: () => api.get<T.ClassDetail>(`/classes/${id}`), enabled: !!id });
export const useSubjects = () => useQuery({ queryKey: ["subjects"], queryFn: () => api.get<T.Subject[]>("/subjects"), staleTime: LONG });
export const useGradeBands = () => useQuery({ queryKey: ["gradeBands"], queryFn: () => api.get<T.GradeBand[]>("/grade-bands"), staleTime: LONG });
export const useStaff = () => useQuery({ queryKey: ["staff"], queryFn: () => api.get<T.Staff[]>("/staff"), staleTime: LONG });

// ---------- dashboard & portal ----------

export const useDashboard = () =>
  useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<T.StaffDashboard>("/dashboard"), refetchInterval: 60_000 });
export const usePortalChildren = () =>
  useQuery({ queryKey: ["portal", "children"], queryFn: () => api.get<T.PortalChild[]>("/portal/children") });

// ---------- students ----------

export const useStudents = (params: Params) =>
  useQuery({
    queryKey: ["students", params],
    queryFn: ({ signal }) => api.get<T.Paginated<T.StudentListItem>>("/students", params, signal),
    placeholderData: keepPreviousData,
  });
export const useStudent = (id: string) =>
  useQuery({ queryKey: ["student", id], queryFn: () => api.get<T.StudentDetail>(`/students/${id}`), enabled: !!id });
export const useStudentAttendance = (id: string) =>
  useQuery({ queryKey: ["student", id, "attendance"], queryFn: () => api.get<T.StudentAttendance>(`/students/${id}/attendance`), enabled: !!id });
export const useStudentResults = (id: string) =>
  useQuery({ queryKey: ["student", id, "results"], queryFn: () => api.get<T.StudentResults>(`/students/${id}/results`), enabled: !!id });
export const useStudentInvoices = (id: string, enabled = true) =>
  useQuery({ queryKey: ["student", id, "invoices"], queryFn: () => api.get<T.InvoiceListItem[]>(`/students/${id}/invoices`), enabled: !!id && enabled });
export const useStudentPayments = (id: string, enabled = true) =>
  useQuery({ queryKey: ["student", id, "payments"], queryFn: () => api.get<T.Payment[]>(`/students/${id}/payments`), enabled: !!id && enabled });

// ---------- admissions ----------

export const useApplications = (params: Params) =>
  useQuery({
    queryKey: ["applications", params],
    queryFn: ({ signal }) => api.get<T.Paginated<T.ApplicationListItem>>("/applications", params, signal),
    placeholderData: keepPreviousData,
  });
export const useApplicationCounts = (enabled = true) =>
  useQuery({ queryKey: ["applications", "counts"], queryFn: () => api.get<Record<string, number>>("/applications/counts"), enabled });
export const useApplication = (id: string) =>
  useQuery({ queryKey: ["application", id], queryFn: () => api.get<T.Application & { gradeName: string }>(`/applications/${id}`) });

// ---------- attendance ----------

export const useAttendanceSummary = (date?: string) =>
  useQuery({ queryKey: ["attendance", "summary", date ?? "today"], queryFn: () => api.get<T.AttendanceDaySummary>("/attendance/summary", { date }) });
export const useAttendanceSheet = (classId: string, date?: string) =>
  useQuery({
    queryKey: ["attendance", "sheet", classId, date ?? "today"],
    queryFn: () => api.get<T.AttendanceSheet>("/attendance", { classId, date }),
    enabled: !!classId,
  });

// ---------- exams & results ----------

export const useExams = (yearId?: string) =>
  useQuery({ queryKey: ["exams", yearId ?? "current"], queryFn: () => api.get<T.Exam[]>("/exams", { yearId }) });
export const useExamProgress = (examId: string) =>
  useQuery({ queryKey: ["exam", examId, "progress"], queryFn: () => api.get<T.ExamProgress>(`/exams/${examId}/progress`), enabled: !!examId });
export const useMarkSheet = (examId: string, classId: string, subjectId: string) =>
  useQuery({
    queryKey: ["marks", examId, classId, subjectId],
    queryFn: () => api.get<T.MarkSheet>(`/exams/${examId}/marks`, { classId, subjectId }),
    enabled: !!examId && !!classId && !!subjectId,
  });
export const useReportCardOverview = (examId: string) =>
  useQuery({
    queryKey: ["reportCards", "overview", examId],
    queryFn: () => api.get<T.ReportCardOverviewRow[]>("/report-cards/overview", { examId }),
    enabled: !!examId,
  });
export const useReportCardClass = (examId: string, classId: string) =>
  useQuery({
    queryKey: ["reportCards", "class", examId, classId],
    queryFn: () => api.get<T.ReportCardClassView>("/report-cards", { examId, classId }),
    enabled: !!examId && !!classId,
  });
export const useReportCardBatch = (examId: string, classId: string) =>
  useQuery({
    queryKey: ["reportCards", "batch", examId, classId],
    queryFn: () => api.get<T.ReportCard[]>("/report-cards/batch", { examId, classId }),
    enabled: !!examId && !!classId,
  });
export const useReportCard = (examId: string, studentId: string) =>
  useQuery({
    queryKey: ["reportCard", examId, studentId],
    queryFn: () => api.get<T.ReportCard>(`/report-cards/${examId}/${studentId}`),
    enabled: !!examId && !!studentId,
  });
export const usePromotionPreview = () =>
  useQuery({ queryKey: ["promotions"], queryFn: () => api.get<T.PromotionPreview>("/promotions/preview") });

// ---------- fees ----------

export const useFeesSummary = () => useQuery({ queryKey: ["fees", "summary"], queryFn: () => api.get<T.FeesSummary>("/fees/summary") });
export const useInvoices = (params: Params) =>
  useQuery({
    queryKey: ["invoices", params],
    queryFn: ({ signal }) => api.get<T.Paginated<T.InvoiceListItem>>("/invoices", params, signal),
    placeholderData: keepPreviousData,
  });
export const useInvoice = (id: string) =>
  useQuery({ queryKey: ["invoice", id], queryFn: () => api.get<T.InvoiceDetail>(`/invoices/${id}`), enabled: !!id });
export const usePayments = (params: Params) =>
  useQuery({
    queryKey: ["payments", params],
    queryFn: ({ signal }) => api.get<T.Paginated<T.PaymentListItem>>("/payments", params, signal),
    placeholderData: keepPreviousData,
  });
export const usePayment = (id: string) =>
  useQuery({ queryKey: ["payment", id], queryFn: () => api.get<T.PaymentListItem & { school: T.School }>(`/payments/${id}`), enabled: !!id });
export const useDefaulters = (params: Params) =>
  useQuery({ queryKey: ["defaulters", params], queryFn: () => api.get<T.Defaulter[]>("/fees/defaulters", params), placeholderData: keepPreviousData });
export const useFeeTypes = () => useQuery({ queryKey: ["feeTypes"], queryFn: () => api.get<T.FeeType[]>("/fee-types") });
export const useFeeStructures = () => useQuery({ queryKey: ["feeStructures"], queryFn: () => api.get<T.FeeStructure[]>("/fee-structures") });
export const useDiscounts = () => useQuery({ queryKey: ["discounts"], queryFn: () => api.get<T.Discount[]>("/discounts") });
export const usePayHereOrder = (id: string, poll = false) =>
  useQuery({
    queryKey: ["payhereOrder", id],
    queryFn: () =>
      api.get<{
        id: string;
        status: "pending" | "success" | "failed" | "cancelled";
        amount: number;
        studentName: string;
        invoiceNumbers: string[];
        receiptNo?: string;
        paymentId?: string;
        merchant: string;
      }>(`/payhere/orders/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (poll && q.state.data?.status === "pending" ? 2000 : false),
  });

// ---------- communication ----------

export const useMessages = (params: Params) =>
  useQuery({
    queryKey: ["messages", params],
    queryFn: () => api.get<T.Paginated<T.MessageLog>>("/messages", params),
    placeholderData: keepPreviousData,
    // poll while anything is still being delivered
    refetchInterval: (q) => (q.state.data?.items.some((m) => m.status === "queued" || m.status === "sending") ? 2000 : false),
  });
export const useAudience = (type: T.AudienceType, ids: string[]) =>
  useQuery({
    queryKey: ["audience", type, ids],
    queryFn: () => api.get<{ count: number; label: string }>("/messages/audience", { type, ids: ids.join(",") }),
  });
export const useNotices = () => useQuery({ queryKey: ["notices"], queryFn: () => api.get<T.Notice[]>("/notices") });

// ---------- users, roles, audit ----------

export type UserRow = T.User & { roleNames: string[] };
export const useUsers = (params: Params) =>
  useQuery({
    queryKey: ["users", params],
    queryFn: ({ signal }) => api.get<T.Paginated<UserRow>>("/users", params, signal),
    placeholderData: keepPreviousData,
  });
export const useRoles = () => useQuery({ queryKey: ["roles"], queryFn: () => api.get<T.Role[]>("/roles") });
export const useAuditLog = (params: Params) =>
  useQuery({
    queryKey: ["auditLog", params],
    queryFn: () => api.get<T.Paginated<T.AuditEntry>>("/audit-log", params),
    placeholderData: keepPreviousData,
  });
