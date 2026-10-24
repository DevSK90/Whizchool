import type { Metadata } from "next";
import { serverT } from "@/i18n/server";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: serverT("auth.login.submit") };

export default function LoginPage() {
  return <LoginForm />;
}
