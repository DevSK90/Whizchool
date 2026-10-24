/** Public origin of the site, used for canonical URLs, the sitemap and Open Graph images. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** The only pages search engines may index; everything else is noindex (see the root layout). */
export const INDEXED_PATHS = ["/", "/apply"] as const;
