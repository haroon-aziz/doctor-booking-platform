import type { Metadata } from "next";
import { Suspense } from "react";

import { SignInForm } from "@/features/auth/components/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to manage your appointments, records and consultations.",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  // `useSearchParams` inside the form requires a Suspense boundary.
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
      <SignInForm />
    </Suspense>
  );
}
