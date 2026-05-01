import { ApiRequestError } from "../services/api";

/** User-facing message from stock adjustment / reversal API errors */
export function stockAdjustmentUserMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}
