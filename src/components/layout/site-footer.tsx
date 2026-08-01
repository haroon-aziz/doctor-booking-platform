import { Stethoscope } from "lucide-react";
import Link from "next/link";

const COLUMNS = [
  {
    heading: "Patients",
    links: [
      { href: "/doctors", label: "Find a doctor" },
      { href: "/specialties", label: "Browse specialties" },
      { href: "/assistant", label: "AI health assistant" },
      { href: "/appointments", label: "My appointments" },
    ],
  },
  {
    heading: "Doctors",
    links: [
      { href: "/for-doctors", label: "Join as a doctor" },
      { href: "/doctor/schedule", label: "Manage schedule" },
      { href: "/doctor/dashboard", label: "Doctor dashboard" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/support", label: "Support" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="container grid gap-10 py-12 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Stethoscope className="size-4" />
            </span>
            MediBook
          </Link>
          <p className="max-w-xs text-sm text-muted-foreground">
            Verified doctors, real-time availability, and consultations that fit around your day.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.heading} aria-label={column.heading} className="space-y-3">
            <h2 className="text-sm font-semibold">{column.heading}</h2>
            <ul className="space-y-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t">
        <div className="container flex flex-col gap-2 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} MediBook. For demonstration purposes.</p>
          <p>
            MediBook does not provide emergency care. In an emergency, call your local emergency
            number immediately.
          </p>
        </div>
      </div>
    </footer>
  );
}
