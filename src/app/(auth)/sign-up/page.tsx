import type { Metadata } from "next";

import { SignUpForm } from "@/features/auth/components/sign-up-form";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a MediBook account to book appointments with verified doctors.",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return <SignUpForm />;
}
