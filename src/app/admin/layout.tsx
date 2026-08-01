import { BadgeCheck, LayoutDashboard, ScrollText } from "lucide-react";

import { PortalNav, type PortalNavItem } from "@/components/layout/portal-nav";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Authoritative role check — middleware only saw a session cookie.
  const user = await requireRole("ADMIN", "SUPER_ADMIN");

  const pendingVerifications = await prisma.doctor.count({
    where: { verificationStatus: { in: ["PENDING", "UNDER_REVIEW"] } },
  });

  const nav: PortalNavItem[] = [
    { href: "/admin", label: "Overview", icon: LayoutDashboard },
    {
      href: "/admin/doctors",
      label: "Verification",
      icon: BadgeCheck,
      badge: pendingVerifications,
    },
    { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  ];

  return (
    <div className="container grid gap-8 py-8 lg:grid-cols-[220px_1fr] lg:items-start">
      <aside className="lg:sticky lg:top-20">
        <div className="mb-4 rounded-lg border bg-card p-3">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">
            {user.role === "SUPER_ADMIN" ? "Super administrator" : "Administrator"}
          </p>
        </div>
        <PortalNav items={nav} />
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
