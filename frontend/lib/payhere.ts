import type { PayHereCheckout } from "@/lib/api/types";

/**
 * Sends the browser to PayHere. The API returns a signed field set; PayHere expects a form POST.
 * In mock mode the action URL is a local sandbox page, reached by client-side navigation.
 */
export function startPayHereCheckout(checkout: PayHereCheckout, navigate: (url: string) => void) {
  if (checkout.actionUrl.startsWith("/")) {
    navigate(checkout.actionUrl);
    return;
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = checkout.actionUrl;
  for (const [name, value] of Object.entries(checkout.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
