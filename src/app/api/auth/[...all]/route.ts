import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth";

/**
 * Better Auth mounts its whole surface here: sign-in, sign-up, sign-out,
 * session, email verification, password reset and account linking.
 */
export const { GET, POST } = toNextJsHandler(auth.handler);
