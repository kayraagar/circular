import { features } from "@/config/features";

export type AttendanceState = "CANCELLED" | "CHECKED_IN" | "NO_SHOW" | "EXPECTED" | "NOT_TRACKED";

export const ATTENDANCE_LABELS: Record<AttendanceState, string> = {
  CANCELLED: "İptal",
  CHECKED_IN: "Giriş yaptı",
  NO_SHOW: "Gelmedi",
  EXPECTED: "Bekleniyor",
  NOT_TRACKED: "Giriş verisi yok",
};

/**
 * Katılım durumu kayıttan TÜRETİLİR, saklanmaz.
 * - No-show yalnızca giriş süresi (entryClosesAt ?? endsAt) bittikten sonra ve
 *   check-in gerçekten ölçülüyorsa belirlenir. Faz 1'de check-in olmadığı için
 *   geçmiş etkinliklerde "Giriş verisi yok" döner — "gelmedi" uydurulmaz.
 */
export function attendanceState(
  registration: { accessStatus: string; checkInCount?: number },
  event: { endsAt: Date; entryClosesAt: Date | null },
  now = new Date(),
  checkInEnabled: boolean = features.checkIn,
): AttendanceState {
  if (registration.accessStatus === "CANCELLED") return "CANCELLED";
  if ((registration.checkInCount ?? 0) > 0) return "CHECKED_IN";
  const entryClosed = now.getTime() > (event.entryClosesAt ?? event.endsAt).getTime();
  if (!entryClosed) return "EXPECTED";
  return checkInEnabled ? "NO_SHOW" : "NOT_TRACKED";
}
