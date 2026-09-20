import type { FieldErrors } from "./errors";

/** Server Action ↔ istemci form durumu (client bileşenleri de import eder). */
export type ActionState<D = unknown> =
  | { status: "idle" }
  | { status: "success"; message: string; data?: D; at: number }
  | {
      status: "error";
      message: string;
      code?: string;
      detail?: D;
      fieldErrors?: FieldErrors;
      values?: Record<string, unknown>;
      at: number;
    };

export const IDLE: ActionState = { status: "idle" };

export function fieldError(state: ActionState, name: string): string | undefined {
  return state.status === "error" ? state.fieldErrors?.[name]?.[0] : undefined;
}

export function valueOf(state: ActionState, name: string, fallback = ""): string {
  if (state.status !== "error" || !state.values) return fallback;
  const v = state.values[name];
  return typeof v === "string" ? v : fallback;
}
