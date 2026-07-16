/**
 * Canonical storage format for Indian mobile numbers: 10-digit local (no country code).
 * Use `formatPhoneForWhatsApp` when sending via MSG91 (requires 91 prefix).
 */

/** Strip non-digits and normalize to 10-digit Indian local number when possible. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }

  if (digits.length === 10) {
    return digits;
  }

  if (digits.length > 10 && digits.startsWith("91")) {
    const tail = digits.slice(-10);
    if (tail.length === 10) return tail;
  }

  return digits;
}

/** Alias for search/filter — same canonical form as storage. */
export function normalizePhoneForSearch(phone: string): string {
  return normalizePhone(phone);
}

/** MSG91 / WhatsApp outbound expects country code prefix. */
export function formatPhoneForWhatsApp(phone: string): string {
  const local = normalizePhone(phone);
  if (local.length === 10) return `91${local}`;
  if (local.length === 12 && local.startsWith("91")) return local;
  return local;
}

/** True when the query is mostly digits (phone search). */
export function looksLikePhoneQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 4 && digits.length / trimmed.replace(/\s/g, "").length >= 0.5;
}

/** Normalize optional phone fields for persistence; returns null when empty/invalid. */
export function normalizePhoneOrNull(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const normalized = normalizePhone(phone.trim());
  return normalized || null;
}
