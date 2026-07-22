import { env } from "../config/env";

/** Public PDF URL proxied through the frontend domain (Apache proxies /api to backend). */
export function getQuotationPdfPublicUrl(quotationId: string): string {
  const base = env.FRONTEND_URL.replace(/\/$/, "");
  return `${base}/api/public/quotations/${quotationId}/pdf`;
}

export function getGalleryPdfPublicUrl(galleryId: string): string {
  const base = env.FRONTEND_URL.replace(/\/$/, "");
  return `${base}/api/public/galleries/${galleryId}/pdf`;
}
