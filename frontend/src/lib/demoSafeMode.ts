/** Module-level flags so `apiFetch` can enforce SAFE demo without importing React. */

let demoSafeActive = false;
let showSuccessToast: ((message: string) => void) | null = null;

export function setDemoSafeActive(next: boolean): void {
  demoSafeActive = Boolean(next);
}

export function registerDemoSafeToast(handler: ((message: string) => void) | null): void {
  showSuccessToast = handler;
}

export function isDemoSafeMutationsBlocked(): boolean {
  return demoSafeActive;
}

/** Login must always reach the API, even when demo tour state is enabled in-memory. */
export function isAuthApiPath(path: string): boolean {
  let pathname = path;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    try {
      pathname = new URL(path).pathname;
    } catch {
      return false;
    }
  }
  return pathname.startsWith("/api/auth/");
}

const DEMO_SAFE_TOAST = "✔ Step completed (Demo)";

export function notifyDemoMutationBlocked(): void {
  showSuccessToast?.(DEMO_SAFE_TOAST);
}
