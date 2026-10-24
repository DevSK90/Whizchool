"use client";

import { Mail, MapPin, Phone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublicSchool } from "@/lib/api/hooks";

export function SchoolContact() {
  const { data: school } = usePublicSchool();
  if (!school) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      <p className="text-base font-semibold">{school.name}</p>
      <p className="text-muted-foreground italic">{school.motto}</p>
      <p className="flex items-center gap-2">
        <MapPin className="size-4 text-muted-foreground" /> {school.address}
      </p>
      <p className="flex items-center gap-2">
        <Phone className="size-4 text-muted-foreground" />
        <a className="hover:underline" href={`tel:${school.phone.replace(/\s/g, "")}`}>{school.phone}</a>
      </p>
      <p className="flex items-center gap-2">
        <Mail className="size-4 text-muted-foreground" />
        <a className="hover:underline" href={`mailto:${school.email}`}>{school.email}</a>
      </p>
    </div>
  );
}
