import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";

export default function PanelNotFound() {
  return (
    <div className="card">
      <EmptyState
        title="Kayıt bulunamadı"
        description="Bu kayıt silinmiş, arşivlenmiş ya da aktif işletmenize ait olmayabilir."
        action={<ButtonLink href="/">Ana sayfaya dön</ButtonLink>}
      />
    </div>
  );
}
