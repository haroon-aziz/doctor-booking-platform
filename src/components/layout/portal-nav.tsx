"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export interface PortalNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

/**
 * Sidebar navigation shared by the doctor and admin portals.
 *
 * Active state is matched on the path *segment*, not `startsWith`, so
 * `/admin/doctors` does not also light up `/admin`.
 */
export function PortalNav({ items }: { items: PortalNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Portal" className="space-y-1">
      {items.map(({ href, label, icon: Icon, badge }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            <span className="flex-1">{label}</span>
            {badge !== undefined && badge > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
