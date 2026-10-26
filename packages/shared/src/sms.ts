// How long an SMS is in billable parts. Sinhala and Tamil text needs the UCS-2 encoding, which
// fits far fewer characters per message than English text in the GSM 7-bit alphabet.

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** Characters that exist in GSM-7 but take two positions (escape + character). */
const GSM_EXTENDED = "^{}\\[~]|€\f";

export interface SmsLength {
  encoding: "GSM-7" | "UCS-2";
  /** Characters as the network counts them (extended GSM characters count twice). */
  units: number;
  /** Billable messages the text is split into. */
  parts: number;
  /** Characters available per part at this length (160/153 for GSM-7, 70/67 for UCS-2). */
  perPart: number;
}

/** Most messages a school SMS may use: three parts. */
export const SMS_MAX_PARTS = 3;

export function smsLength(text: string): SmsLength {
  let gsm = true;
  let units = 0;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) units += 1;
    else if (GSM_EXTENDED.includes(ch)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (!gsm) {
    // UCS-2 counts UTF-16 code units: an emoji takes two.
    units = text.length;
    const parts = units <= 70 ? 1 : Math.ceil(units / 67);
    return { encoding: "UCS-2", units, parts: Math.max(1, parts), perPart: parts > 1 ? 67 : 70 };
  }
  const parts = units <= 160 ? 1 : Math.ceil(units / 153);
  return { encoding: "GSM-7", units, parts: Math.max(1, parts), perPart: parts > 1 ? 153 : 160 };
}
