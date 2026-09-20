"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";

export default function PanelError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card">
      <EmptyState
        title="Bir şeyler ters gitti"
        description="Sayfa yüklenirken beklenmeyen bir hata oluştu. Verileriniz etkilenmedi; tekrar deneyebilirsiniz."
        action={
          <Button variant="secondary" onClick={reset}>
            Tekrar dene
          </Button>
        }
      />
    </div>
  );
}
