import { EVENT_STATUS_LABELS, labelOf } from "@/lib/domain";
import { Badge } from "@/components/ui/primitives";

export function EventStatusBadge({ status, ended }: { status: string; ended?: boolean }) {
  if (status === "CANCELLED") return <Badge tone="negative">{EVENT_STATUS_LABELS.CANCELLED}</Badge>;
  if (ended) return <Badge tone="muted">Sona erdi</Badge>;
  if (status === "DRAFT") return <Badge tone="caution">{EVENT_STATUS_LABELS.DRAFT}</Badge>;
  return <Badge tone="neutral">{labelOf(EVENT_STATUS_LABELS, status)}</Badge>;
}
