import type { NextRequest } from "next/server";
import { can } from "@/lib/authz";
import { getAppContext } from "@/lib/context";
import { parseReportSet, reportCsv } from "@/modules/reports/csv";
import { getReports, parseReportRange } from "@/modules/reports/service";

/**
 * Rapor verisinin CSV indirmesi. Ekrandaki dönem, mekan kapsamı ve yetki aynen geçerlidir;
 * veriyi servis üretir, burada yalnızca biçimlendirilir.
 */
export async function GET(request: NextRequest) {
  const ctx = await getAppContext();
  if (!ctx) return new Response("Oturum gerekli.", { status: 401 });
  if (!can(ctx.membership.role, "reports.view")) return new Response("Bu veriyi görme yetkiniz yok.", { status: 403 });

  const params = request.nextUrl.searchParams;
  const range = parseReportRange({ period: params.get("period"), from: params.get("from"), to: params.get("to") });
  const data = await getReports(ctx.service, { range, venueId: ctx.activeVenue?.id ?? null });
  const { filename, body } = reportCsv(parseReportSet(params.get("set")), data);

  // BOM: Excel dosyayı UTF-8 olarak açsın (aksi halde Türkçe karakterler bozulur).
  return new Response(`﻿${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
