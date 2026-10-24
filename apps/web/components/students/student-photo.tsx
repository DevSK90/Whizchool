"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Camera, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api/client";
import { initials } from "@/lib/format";
import { checkFile, uploadFile } from "@/lib/uploads";
import { cn } from "@/lib/utils";

/** Student avatar; staff with edit rights can upload, replace or remove the photo. */
export function StudentPhoto({
  studentId,
  name,
  photoUrl,
  editable,
  className,
}: {
  studentId: string;
  name: string;
  photoUrl?: string;
  editable?: boolean;
  className?: string;
}) {
  const t = useTranslations("students.photo");
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function save(fileId: string | null, message: string) {
    await api.put(`/students/${studentId}/photo`, { fileId });
    await qc.invalidateQueries({ queryKey: ["student", studentId] });
    qc.invalidateQueries({ queryKey: ["portal"] });
    toast.success(message);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const problem = checkFile(file, "student-photo");
    if (problem) return toast.error(t(problem));
    setBusy(true);
    try {
      const ref = await uploadFile(file, "student-photo");
      await save(ref.id, t("updated"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const avatar = (
    <Avatar className={cn("size-10", className)}>
      {photoUrl && <AvatarImage src={photoUrl} alt={name} className="object-cover" />}
      <AvatarFallback className="bg-primary/10 text-primary">{initials(name)}</AvatarFallback>
    </Avatar>
  );
  if (!editable) return avatar;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group relative rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            aria-label={photoUrl ? t("change") : t("upload")}
            disabled={busy}
          >
            {avatar}
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {busy ? <Spinner className="size-4" /> : <Camera className="size-4" />}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => input.current?.click()}>
            <Camera /> {photoUrl ? t("change") : t("upload")}
          </DropdownMenuItem>
          {photoUrl && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => save(null, t("removed")).catch((e) => toast.error(errorMessage(e)))}
            >
              <Trash2 /> {t("remove")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
    </>
  );
}
