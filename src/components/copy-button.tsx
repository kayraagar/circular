"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconCheck } from "@/components/ui/icons";
import { toast } from "@/components/ui/toaster";

export function CopyButton({ value, label = "Kopyala" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      className="!h-10 shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast("Bağlantı kopyalandı.");
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          toast("Kopyalanamadı; bağlantıyı elle seçip kopyalayın.", "error");
        }
      }}
    >
      {copied && <IconCheck size={14} />}
      {copied ? "Kopyalandı" : label}
    </Button>
  );
}
