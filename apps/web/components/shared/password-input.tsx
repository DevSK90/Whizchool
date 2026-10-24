"use client";

import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

export function PasswordInput(props: ComponentProps<typeof InputGroupInput>) {
  const t = useTranslations("auth.password");
  const [show, setShow] = useState(false);
  return (
    <InputGroup>
      <InputGroupInput {...props} type={show ? "text" : "password"} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label={show ? t("hide") : t("show")} onClick={() => setShow((s) => !s)}>
          {show ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
