import { redirect } from "next/navigation";
import { requireAppContext } from "@/lib/context";
import { homePathForRole } from "@/lib/routes";

export default async function Home() {
  const ctx = await requireAppContext();
  redirect(homePathForRole(ctx.membership.role));
}
