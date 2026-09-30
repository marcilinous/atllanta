import type { CorrectionRow } from "@/src/lib/hrms/attendance/queries";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatTime } from "../format";

const STATUS: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
  approved: { variant: "default", label: "Approved" },
  pending: { variant: "secondary", label: "Pending" },
  rejected: { variant: "destructive", label: "Rejected" },
};

export default function MyCorrections({ corrections, timeZone }: { corrections: CorrectionRow[]; timeZone: string }) {
  if (corrections.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No corrections requested.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {corrections.map((c) => {
        const status = STATUS[c.status] ?? { variant: "outline" as const, label: c.status };
        return (
          <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{formatDate(c.date)}</p>
              <p className="text-xs">
                Asked for: in {formatTime(c.requestedCheckIn, timeZone)} &middot; out{" "}
                {formatTime(c.requestedCheckOut, timeZone)}
              </p>
              {c.reason ? <p className="text-xs text-muted-foreground">{c.reason}</p> : null}
            </div>
            <Badge variant={status.variant}>{status.label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}
