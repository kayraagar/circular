/**
 * PR talimatları — saf tanımlar (istemci ve sunucu birlikte kullanır).
 */

export const PR_TASK_KINDS = ["ANNOUNCEMENT", "TODO", "GUEST_TARGET"] as const;
export type PrTaskKind = (typeof PR_TASK_KINDS)[number];

export const PR_TASK_KIND_LABELS: Record<PrTaskKind, string> = {
  ANNOUNCEMENT: "Duyuru",
  TODO: "Görev",
  GUEST_TARGET: "Misafir hedefi",
};

export const PR_TASK_KIND_HINTS: Record<PrTaskKind, string> = {
  ANNOUNCEMENT: "Bilgilendirme. PR okuduğunu onaylar.",
  TODO: "Yapılacak iş. PR tamamlandığında işaretler.",
  GUEST_TARGET: "Seçili etkinlik için PR başına kişi hedefi. İlerleme PR'ın gerçek misafir kayıtlarından hesaplanır.",
};

export const PR_TASK_LIMITS = { title: 90, body: 600, maxTarget: 5000 } as const;

export type RecipientState = "UNREAD" | "READ" | "DONE";

export const RECIPIENT_STATE_LABELS: Record<RecipientState, string> = {
  UNREAD: "Okunmadı",
  READ: "Okundu",
  DONE: "Tamamlandı",
};

export function recipientState(r: { readAt: Date | null; completedAt: Date | null }): RecipientState {
  if (r.completedAt) return "DONE";
  return r.readAt ? "READ" : "UNREAD";
}

/** Misafir hedefinde ilerleme kişi bazlıdır; hedefe ulaşmak kaydedilmiş (iptal edilmemiş) misafir kişi sayısıyla ölçülür. */
export function targetProgress(people: number, target: number | null): number {
  if (!target || target <= 0) return 0;
  return Math.min(1, people / target);
}
