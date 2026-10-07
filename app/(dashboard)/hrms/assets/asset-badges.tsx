import { Badge } from "@/components/ui/badge";

const STATUS: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
  available: { variant: "default", label: "Available" },
  assigned: { variant: "secondary", label: "Assigned" },
  maintenance: { variant: "outline", label: "Maintenance" },
  retired: { variant: "outline", label: "Retired" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { variant: "outline" as const, label: status };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/** Warranty against the org's today: in force through its last day. */
export function WarrantyBadge({ warrantyEnd, today }: { warrantyEnd: string | null; today: string }) {
  if (!warrantyEnd) return <span className="text-xs text-muted-foreground">—</span>;
  return warrantyEnd >= today ? (
    <Badge variant="secondary">Under warranty</Badge>
  ) : (
    <Badge variant="destructive">Warranty expired</Badge>
  );
}
