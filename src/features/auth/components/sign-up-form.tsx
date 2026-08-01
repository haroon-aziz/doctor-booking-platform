"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpSchema, type SignUpInput } from "@/features/auth/schemas/auth.schema";
import { signUp } from "@/lib/auth/client";
import { cn } from "@/lib/utils/cn";

/** Live feedback on the two rules that actually matter. */
function PasswordChecklist({ value }: { value: string }) {
  const rules = [
    { label: "At least 10 characters", met: value.length >= 10 },
    { label: "Not only letters", met: /[^a-zA-Z]/.test(value) && value.length > 0 },
  ];

  return (
    <ul className="space-y-1">
      {rules.map((rule) => (
        <li
          key={rule.label}
          className={cn(
            "flex items-center gap-1.5 text-xs",
            rule.met ? "text-success" : "text-muted-foreground",
          )}
        >
          <Check aria-hidden className={cn("size-3", !rule.met && "opacity-40")} />
          {rule.label}
        </li>
      ))}
    </ul>
  );
}

export function SignUpForm() {
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", phone: "", password: "", confirmPassword: "" },
  });

  const password = watch("password") ?? "";

  async function onSubmit(values: SignUpInput) {
    setFormError(null);

    // `role` is never sent: it is `input: false` server-side and would be
    // ignored anyway. Accounts always start as PATIENT.
    const { error } = await signUp.email({
      name: values.name,
      email: values.email,
      password: values.password,
      ...(values.phone ? { phone: values.phone } : {}),
    });

    if (error) {
      setFormError(
        error.code === "USER_ALREADY_EXISTS"
          ? "An account with that email already exists. Try signing in instead."
          : (error.message ?? "We could not create your account. Please try again."),
      );
      return;
    }

    router.push("/appointments");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Already registered?{" "}
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>

      {formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" autoComplete="name" aria-invalid={Boolean(errors.name)} {...register("name")} />
          {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
          />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">
            Mobile number <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+923001234567"
            aria-invalid={Boolean(errors.phone)}
            {...register("phone")}
          />
          {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
          <p className="text-xs text-muted-foreground">Used only for appointment reminders.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            {...register("password")}
          />
          <PasswordChecklist value={password} />
          {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirmPassword)}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
          )}
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-input accent-[hsl(var(--primary))]"
            {...register("acceptTerms")}
          />
          <span>
            I agree to the{" "}
            <Link href="/terms" className="text-primary hover:underline">
              terms of service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              privacy policy
            </Link>
            .
          </span>
        </label>
        {errors.acceptTerms && <p className="text-sm text-destructive">{errors.acceptTerms.message}</p>}

        <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
          {isSubmitting && <Loader2 aria-hidden className="animate-spin" />}
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Are you a doctor?{" "}
        <Link href="/for-doctors" className="text-primary hover:underline">
          Apply to join the directory
        </Link>
      </p>
    </div>
  );
}
