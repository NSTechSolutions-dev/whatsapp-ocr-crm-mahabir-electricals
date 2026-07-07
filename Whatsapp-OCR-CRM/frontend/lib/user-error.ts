/** Short, user-facing error text (mirrors backend helper). */
export function formatUserErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  const raw = typeof error === "string" ? error : "";
  const text = raw.trim();
  if (!text) return fallback;

  const lower = text.toLowerCase();

  if (lower.includes("quota exceeded") || lower.includes("exceeded your current quota")) {
    const retryMatch = text.match(/retry in ([\d.]+)s/i);
    if (retryMatch) {
      const secs = Math.max(1, Math.ceil(parseFloat(retryMatch[1])));
      return `Gemini API quota exceeded. Retry in ~${secs}s.`;
    }
    return "Gemini API quota exceeded. Please retry shortly.";
  }

  if (
    lower.includes("rate limit") ||
    lower.includes("rate-limit") ||
    lower.includes("too many requests") ||
    lower.includes("429")
  ) {
    return "Gemini rate limit reached. Please retry shortly.";
  }

  if (lower.includes("api key") || lower.includes("unauthorized") || lower.includes("403")) {
    return "Gemini API authentication failed.";
  }

  if (lower.includes("timeout") || lower.includes("etimedout") || lower.includes("timed out")) {
    return "Gemini request timed out. Please retry.";
  }

  if (
    lower.includes("econnreset") ||
    lower.includes("enotfound") ||
    lower.includes("network") ||
    lower.includes("socket hang up")
  ) {
    return "Network error contacting Gemini. Please retry.";
  }

  if (lower.includes("gemini")) {
    return "Gemini processing failed. Please try again.";
  }

  if (text.length > 100) {
    const firstLine = text.split("\n")[0]?.trim() || text;
    if (firstLine.length <= 100) return firstLine;
    return `${firstLine.slice(0, 97)}…`;
  }

  return text;
}
