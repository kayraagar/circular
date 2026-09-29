import { can } from "@/lib/authz";
import { getAppContext } from "@/lib/context";
import { AppError } from "@/lib/errors";
import { exportCustomerData } from "@/modules/privacy/service";

/**
 * KVKK m.11-b/c: kişinin verisinin makine okunur dışa aktarımı.
 * Başvuru sahibine verilmek üzere indirilir; yalnızca işletme sahibi erişebilir.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAppContext();
  if (!ctx) return new Response("Oturum gerekli.", { status: 401 });
  if (!can(ctx.membership.role, "privacy.manage")) return new Response("Bu veriyi görme yetkiniz yok.", { status: 403 });

  const { id } = await params;
  let data: Awaited<ReturnType<typeof exportCustomerData>>;
  try {
    data = await exportCustomerData(ctx.service, id);
  } catch (error) {
    if (error instanceof AppError) return new Response(error.message, { status: 404 });
    throw error;
  }

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="kvkk-veri-${id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
