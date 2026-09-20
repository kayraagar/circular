"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { completeEmbeddedSignupAction } from "@/modules/campaigns/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toaster";

type FbLoginResponse = { authResponse?: { code?: string } | null; status?: string };
type FbSdk = {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: FbLoginResponse) => void, options: Record<string, unknown>): void;
};
declare global {
  interface Window {
    FB?: FbSdk;
  }
}

/**
 * Meta Embedded Signup: işletme sahibi Meta penceresinde kendi işletme hesabını ve WhatsApp numarasını seçer.
 * Pencere kodu (~30 sn geçerli) ve numara/hesap kimliklerini döndürür; ikisi gelince sunucuda bağlantı tamamlanır.
 */
export function EmbeddedSignupButton({ appId, configId, graphVersion }: { appId: string; configId: string; graphVersion: string }) {
  const router = useRouter();
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string; done?: boolean }>({});

  const finish = async () => {
    const s = session.current;
    if (s.done || !s.code || !s.wabaId || !s.phoneNumberId) return;
    s.done = true;
    const result = await completeEmbeddedSignupAction({ code: s.code, wabaId: s.wabaId, phoneNumberId: s.phoneNumberId });
    setBusy(false);
    if (result.ok) {
      toast(`${result.data.displayPhoneNumber} bağlandı.`);
      router.refresh();
    } else {
      setError(result.message);
    }
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      let host = "";
      try {
        host = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return;
      let data: { type?: string; event?: string; data?: { phone_number_id?: string; waba_id?: string; error_message?: string } };
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (data.event?.startsWith("FINISH") && data.data?.waba_id && data.data.phone_number_id) {
        session.current.wabaId = data.data.waba_id;
        session.current.phoneNumberId = data.data.phone_number_id;
        void finish();
      } else if (data.event === "CANCEL") {
        setBusy(false);
      } else if (data.event === "ERROR") {
        setBusy(false);
        setError(data.data?.error_message ?? "Meta bağlantı akışı tamamlanamadı.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // finish yalnızca ref ve kararlı set fonksiyonlarını kullanır; dinleyici bir kez kurulur
  }, []);

  const start = () => {
    if (!window.FB) return;
    setError(null);
    setBusy(true);
    session.current = {};
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setBusy(false);
          return;
        }
        session.current.code = code;
        void finish();
      },
      { config_id: configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } },
    );
  };

  return (
    <div className="space-y-3">
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        crossOrigin="anonymous"
        onReady={() => {
          window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion });
          setSdkReady(Boolean(window.FB));
        }}
      />
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <Button variant="primary" onClick={start} disabled={!sdkReady || busy}>
        {(busy || !sdkReady) && <Spinner />}
        {busy ? "Meta penceresi açık" : "WhatsApp numarasını bağla"}
      </Button>
      <p className="text-[12px] leading-relaxed text-muted">
        Meta penceresinde işletmenizin Meta hesabını ve WhatsApp numarasını seçin. Numara WhatsApp Business uygulamasında kullanılıyorsa Meta akışı size seçenekleri gösterir.
      </p>
    </div>
  );
}
