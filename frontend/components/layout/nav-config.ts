import {
  BookOpenCheck,
  CalendarCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  History,
  LayoutDashboard,
  Megaphone,
  Receipt,
  School,
  Settings,
  ShieldCheck,
  TrendingUp,
  Upload,
  UserPlus,
  Users,
  Wallet,
  AlertOctagon,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { PermissionKey } from "@/lib/permissions";

export type NavKey =
  | "dashboard" | "admissions" | "students" | "classes" | "attendance" | "exams" | "reportCards" | "promotions"
  | "fees" | "invoices" | "payments" | "defaulters" | "feeSettings" | "messaging" | "users" | "roles" | "import"
  | "settings" | "auditLog";

export interface NavItem {
  key: NavKey;
  href: string;
  icon: LucideIcon;
  perm: PermissionKey;
}

export interface NavGroup {
  key: "people" | "academics" | "finance" | "communication" | "admin" | null;
  items: NavItem[];
}

export const STAFF_NAV: NavGroup[] = [
  { key: null, items: [{ key: "dashboard", href: "/app", icon: LayoutDashboard, perm: "dashboard.view" }] },
  {
    key: "people",
    items: [
      { key: "admissions", href: "/app/admissions", icon: UserPlus, perm: "admissions.view" },
      { key: "students", href: "/app/students", icon: GraduationCap, perm: "students.view" },
      { key: "classes", href: "/app/classes", icon: School, perm: "classes.view" },
    ],
  },
  {
    key: "academics",
    items: [
      { key: "attendance", href: "/app/attendance", icon: CalendarCheck, perm: "attendance.view" },
      { key: "exams", href: "/app/exams", icon: ClipboardList, perm: "marks.view" },
      { key: "reportCards", href: "/app/report-cards", icon: FileText, perm: "reportCards.view" },
      { key: "promotions", href: "/app/promotions", icon: TrendingUp, perm: "promotions.view" },
    ],
  },
  {
    key: "finance",
    items: [
      { key: "fees", href: "/app/fees", icon: Wallet, perm: "fees.view" },
      { key: "invoices", href: "/app/fees/invoices", icon: Receipt, perm: "fees.view" },
      { key: "payments", href: "/app/fees/payments", icon: BookOpenCheck, perm: "payments.view" },
      { key: "defaulters", href: "/app/fees/defaulters", icon: AlertOctagon, perm: "fees.view" },
      { key: "feeSettings", href: "/app/fees/structure", icon: SlidersHorizontal, perm: "fees.view" },
    ],
  },
  {
    key: "communication",
    items: [{ key: "messaging", href: "/app/messaging", icon: Megaphone, perm: "messaging.view" }],
  },
  {
    key: "admin",
    items: [
      { key: "users", href: "/app/users", icon: Users, perm: "users.view" },
      { key: "roles", href: "/app/users/roles", icon: ShieldCheck, perm: "roles.view" },
      { key: "import", href: "/app/import", icon: Upload, perm: "import.create" },
      { key: "settings", href: "/app/settings", icon: Settings, perm: "settings.view" },
      { key: "auditLog", href: "/app/audit-log", icon: History, perm: "audit.view" },
    ],
  },
];

/** The nav item whose href is the longest prefix of the current path. */
export function activeHref(pathname: string) {
  let best = "";
  for (const g of STAFF_NAV) {
    for (const i of g.items) {
      const match = i.href === "/app" ? pathname === "/app" : pathname === i.href || pathname.startsWith(`${i.href}/`);
      if (match && i.href.length > best.length) best = i.href;
    }
  }
  return best;
}

