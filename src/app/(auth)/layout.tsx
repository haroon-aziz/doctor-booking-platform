import { ShieldCheck, Stethoscope } from "lucide-react";
import Link from "next/link";

const ASSURANCES = [
  "Every doctor's licence is checked before their profile goes live.",
  "Your medical records stay private until you share them with a doctor.",
  "Slots are held while you check out, so a booking never collides.",
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container grid min-h-[calc(100dvh-4rem)] items-center gap-12 py-12 lg:grid-cols-2">
      <div className="mx-auto w-full max-w-md">{children}</div>

      <aside className="hidden rounded-2xl border surface-gradient p-10 lg:block">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Stethoscope className="size-5" />
          </span>
          <span className="text-lg tracking-tight">MediBook</span>
        </Link>

        <h2 className="mt-8 text-balance text-2xl font-semibold tracking-tight">
          Healthcare booking that respects your time — and your privacy.
        </h2>

        <ul className="mt-6 space-y-4">
          {ASSURANCES.map((item) => (
            <li key={item} className="flex gap-3 text-sm text-muted-foreground">
              <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              {item}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
