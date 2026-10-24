"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { useDebouncedValue } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";

/** Debounced search box that reports changes after the user pauses typing. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const t = useTranslations("common");
  const [text, setText] = useState(value);
  const debounced = useDebouncedValue(text, 300);

  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <InputGroup className={cn("w-full sm:w-72", className)}>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? t("searchPlaceholder")}
        aria-label={placeholder ?? t("search")}
      />
      {text && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label={t("clearFilters")} onClick={() => setText("")}>
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
