import { Stethoscope } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";

const NAV_LINKS = [
  { href: "/doctors", label: "Find a doctor" },
  { href: "/specialties", label: "Specialties" },
  { href: "/assistant", label: "AI assistant" },
  { href: "/for-doctors", label: "For doctors" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-16 items-center gap-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Stethoscope className="size-5" />
          </span>
          <span className="text-lg tracking-tight">MediBook</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
