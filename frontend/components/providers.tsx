"use client";

import type { ReactNode } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import { ApiError } from "@/lib/api/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import messages from "@/messages/en";
import { defaultLocale, timeZone } from "@/i18n/config";

let browserQueryClient: QueryClient | undefined;

function makeQueryClient() {
  // Any 401 means the session ended (expired, signed out elsewhere, or account deactivated).
  // Re-check the session; AreaGate then redirects to sign-in with the "session expired" notice.
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      client.invalidateQueries({ queryKey: ["auth", "me"], refetchType: "active" });
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.queryKey[0] !== "auth") onError(error);
      },
    }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Don't retry auth/permission/validation errors — only transient failures.
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      },
    },
  });
  return client;
}

function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <NextIntlClientProvider locale={defaultLocale} messages={messages} timeZone={timeZone}>
        <QueryClientProvider client={getQueryClient()}>
          <TooltipProvider delayDuration={300}>
            {children}
            <Toaster position="top-right" richColors closeButton />
          </TooltipProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>
    </ThemeProvider>
  );
}
