"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client. `baseURL` is intentionally omitted so requests go to the
 * same origin — hardcoding it breaks preview deployments and any host that is
 * not the one the build was made on.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession, requestPasswordReset, resetPassword } =
  authClient;
