export type ProductionWorkspaceScrollWindow = Pick<typeof window, "setTimeout" | "scrollTo">;

export function scrollProductionWorkspaceToActiveEntry(
  formEl: Pick<HTMLElement, "scrollIntoView"> | null | undefined,
  fallbackEl: Pick<HTMLElement, "scrollIntoView"> | null | undefined,
  win: ProductionWorkspaceScrollWindow = window,
): void {
  win.setTimeout(() => {
    const target = formEl ?? fallbackEl ?? null;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    win.scrollTo({ top: 0, behavior: "smooth" });
  }, 80);
}
