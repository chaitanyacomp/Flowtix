import { ApiRequestError, getApiUrl } from "./api";

const SESSION_EXPIRED_MESSAGE = "Session expired. Please login again.";

function parseFilenameFromContentDisposition(cd: string | null, fallback: string): string {
  if (!cd) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/(^")|("$)/g, "").trim()) || fallback;
    } catch {
      return fallback;
    }
  }
  const plain = /filename\s*=\s*("?)([^";\n]+)\1/i.exec(cd);
  if (plain?.[2]) return plain[2].trim() || fallback;
  return fallback;
}

/**
 * Authenticated GET download (blob). Does not use JSON Content-Type.
 * Triggers a browser file save when successful.
 */
export async function apiDownloadAuthorized(path: string, fallbackFileName: string): Promise<void> {
  const token = localStorage.getItem("token");
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const url = getApiUrl(path);
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers });
  } catch (cause) {
    const extra = cause instanceof Error && cause.message ? ` (${cause.message})` : "";
    throw new Error(`Cannot reach the API at ${url}.${extra}`);
  }

  if (!res.ok) {
    let message = `Download failed: ${res.status}`;
    try {
      const text = await res.text();
      try {
        const j = JSON.parse(text) as { error?: { message?: string } };
        if (j?.error?.message) message = j.error.message;
      } catch {
        if (text) message = text.slice(0, 500);
      }
    } catch {
      // ignore
    }
    if (res.status === 401) {
      try {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
      } catch {
        // ignore
      }
      try {
        sessionStorage.setItem("auth:sessionExpiredMessage", SESSION_EXPIRED_MESSAGE);
      } catch {
        // ignore
      }
      if (typeof window !== "undefined" && window.location?.pathname !== "/login") {
        window.location.replace("/login");
      }
      throw new ApiRequestError(SESSION_EXPIRED_MESSAGE, 401);
    }
    throw new ApiRequestError(message, res.status);
  }

  const cd = res.headers.get("Content-Disposition");
  const fileName = parseFilenameFromContentDisposition(cd, fallbackFileName);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(href);
  }
}
