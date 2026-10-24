// Translations for Server Components. Locale is static for now, so no request data is read
// (keeps public pages prerenderable under Cache Components).
import { createTranslator } from "next-intl";
import messages from "@/messages/en";
import { defaultLocale } from "./config";

export const serverT = createTranslator({ locale: defaultLocale, messages });
