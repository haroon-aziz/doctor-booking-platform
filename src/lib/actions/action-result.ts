import { ZodError } from "zod";

import { isAppError, toAppError, type ErrorCode } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger";

/**
 * The uniform envelope every server action returns.
 *
 * Actions never throw across the network boundary: an uncaught throw in a
 * server action reaches the client as an opaque "An error occurred in the
 * Server Components render", which tells the patient nothing and the developer
 * even less. Failures are values here, carrying a stable `code` the UI can
 * branch on and a message safe to display.
 */

export interface ActionError {
  code: ErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
  retryAfter?: number;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionFail<T>(error: ActionError): ActionResult<T> {
  return { ok: false, error };
}

/**
 * Wraps an action body, converting anything thrown into an `ActionError`.
 * Internal detail is logged, never returned.
 */
export async function runAction<T>(
  name: string,
  body: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return actionOk(await body());
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".") || "_form";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return actionFail({
        code: "VALIDATION_ERROR",
        message: "Please correct the highlighted fields.",
        fieldErrors,
      });
    }

    const appError = toAppError(error);

    if (isAppError(error)) {
      logger.warn(
        { action: name, code: appError.code, context: appError.context },
        appError.message,
      );
    } else {
      logger.error({ action: name, err: error }, "Unhandled error in server action");
    }

    return actionFail({
      code: appError.code,
      message: appError.message,
      fieldErrors: appError.fieldErrors,
      retryAfter: appError.retryAfter,
    });
  }
}
