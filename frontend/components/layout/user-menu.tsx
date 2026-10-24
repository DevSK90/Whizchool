"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut, RotateCcw, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { API_MODE } from "@/lib/api/client";
import { useSession, useSignOut } from "@/lib/auth";
import { initials } from "@/lib/format";

async function resetDemo() {
  const { resetMockData } = await import("@/lib/api/mock/server");
  resetMockData();
}

export function UserMenu({ profileHref }: { profileHref: string }) {
  const t = useTranslations("nav.account");
  const tc = useTranslations("common.demo");
  const user = useSession();
  const signOut = useSignOut();
  const router = useRouter();
  const qc = useQueryClient();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label={user.name}>
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">{initials(user.name.replace(/^(Mr|Mrs|Ms|Dr)\.\s*/, ""))}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 truncate text-sm font-medium md:inline">{user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="text-xs text-muted-foreground">{t("signedInAs")}</p>
          <p className="truncate font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{user.roles.map((r) => r.name).join(" · ")}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href={profileHref}>
              <UserRound /> {t("profile")}
            </Link>
          </DropdownMenuItem>
          {API_MODE === "mock" && (
            <DropdownMenuItem
              onSelect={async () => {
                await resetDemo();
                qc.clear();
                toast.success(tc("resetDone"));
                router.replace("/login");
              }}
            >
              <RotateCcw /> {tc("reset")}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut()}>
          <LogOut /> {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
