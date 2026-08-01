import { z } from "zod";

/**
 * Auth input contracts, shared verbatim by the client form and the server.
 * One definition means the browser and the server can never disagree about
 * what counts as valid.
 */

/**
 * Length is the dominant factor in password strength, so the floor is 10
 * characters rather than a shorter string burdened with composition rules that
 * mostly produce `Password1!`.
 */
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "That password is too long.")
  .refine((value) => !/^\s|\s$/.test(value), "Passwords cannot start or end with a space.");

export const emailSchema = z
  .string()
  .min(1, "Email is required.")
  .email("Enter a valid email address.")
  .transform((value) => value.trim().toLowerCase());

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
  // No `.default()` here: it would make the parsed input optional while the
  // output stayed required, which react-hook-form's resolver cannot reconcile.
  // The initial value belongs in the form's `defaultValues` instead.
  rememberMe: z.boolean(),
});

export const signUpSchema = z
  .object({
    name: z
      .string()
      .min(2, "Enter your full name.")
      .max(80, "That name is too long.")
      .transform((value) => value.trim()),
    email: emailSchema,
    phone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +923001234567.")
      .optional()
      .or(z.literal("")),
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, {
      error: "You must accept the terms to create an account.",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
