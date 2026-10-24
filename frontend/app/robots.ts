import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/apply$"],
      disallow: ["/app", "/portal", "/apply/status", "/login", "/forgot-password", "/reset-password", "/invite"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
