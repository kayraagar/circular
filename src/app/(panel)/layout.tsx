import type { ReactNode } from "react";
import { requireAppContext } from "@/lib/context";
import { AppShell } from "@/components/shell/app-shell";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAppContext();
  return <AppShell ctx={ctx}>{children}</AppShell>;
}
