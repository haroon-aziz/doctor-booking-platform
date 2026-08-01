import { CalendarClock, CalendarDays, LayoutDashboard } from "lucide-react";

import { PortalNav, type PortalNavItem } from "@/components/layout/portal-nav";
import { requireDoctor } from "@/lib/auth/session";

// Only routes that exist are listed — a nav entry pointing at a 404 is worse
// than an absent one. Patients, reviews, revenue and profile pages come next.
const NAV: PortalNavItem[] = [
  { href: "/doctor/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/doctor/appointments", label: "Appointments", icon: CalendarDays },
  { href: "/doctor/schedule", label: "Schedule", icon: CalendarClock },
];

export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  // Authoritative check. Middleware only confirmed a session cookie exists; this
  // confirms the account is a doctor and that verification has been approved.
  const { user } = await requireDoctor();

  return (
    <div className="container grid gap-8 py-8 lg:grid-cols-[220px_1fr] lg:items-start">
      <aside className="lg:sticky lg:top-20">
        <div className="mb-4 rounded-lg border bg-card p-3">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">Doctor portal</p>
        </div>
        <PortalNav items={NAV} />
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
