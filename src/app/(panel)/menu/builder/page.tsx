import { redirect } from "next/navigation";

/**
 * Menü oluşturucu artık doğrudan QR Menü sayfasında (/menu).
 * Eski bağlantılar ve aktivite kayıtlarındaki adresler için yönlendirme.
 * Bu klasördeki bileşenler (builder, kırpma, galeri) /menu sayfası tarafından kullanılır.
 */
export default function MenuBuilderRedirect() {
  redirect("/menu");
}
