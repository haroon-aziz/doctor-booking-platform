import { ScrollText } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = {
  title: "Audit log",
  robots: { index: false, follow: false },
};

const ACTION_VARIANT: Record<string, "default" | "success" | "warning" | "destructive" | "secondary"> = {
  APPROVE: "success",
  REJECT: "destructive",
  SUSPEND: "destructive",
  DELETE: "destructive",
  REFUND: "warning",
  LOGIN_FAILED: "warning",
  CREATE: "default",
  UPDATE: "secondary",
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePermission("audit_log:read");

  const { page: rawPage } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);
  const pageSize = 50;

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.count(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground">
          Immutable record of every consequential change. Sensitive values are redacted at write
          time.
        </p>
      </header>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ScrollText aria-hidden className="size-8 text-muted-foreground" />
            <p className="font-medium">Nothing recorded yet</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Audit entries, most recent first. Page {page}.
                </caption>
                <thead className="border-b bg-muted/40 text-left">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">When</th>
                    <th scope="col" className="px-4 py-2 font-medium">Actor</th>
                    <th scope="col" className="px-4 py-2 font-medium">Action</th>
                    <th scope="col" className="px-4 py-2 font-medium">Entity</th>
                    <th scope="col" className="px-4 py-2 font-medium">Changes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        <time dateTime={entry.createdAt.toISOString()}>
                          {entry.createdAt.toLocaleString("en-GB", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{entry.actor?.name ?? "System"}</p>
                        {entry.actorRole && (
                          <p className="text-xs text-muted-foreground">
                            {entry.actorRole.toLowerCase().replace("_", " ")}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={ACTION_VARIANT[entry.action] ?? "secondary"}>
                          {entry.action.toLowerCase()}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <p>{entry.entityType}</p>
                        {entry.entityId && (
                          <p className="font-mono text-xs text-muted-foreground">
                            {entry.entityId.slice(0, 12)}…
                          </p>
                        )}
                      </td>
                      <td className="max-w-md px-4 py-3">
                        {entry.changes ? (
                          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                            {JSON.stringify(entry.changes, null, 1)}
                          </pre>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-sm text-muted-foreground">
        {total} entries · page {page} of {Math.max(1, Math.ceil(total / pageSize))}
      </p>
    </div>
  );
}
