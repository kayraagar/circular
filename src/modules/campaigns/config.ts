import "server-only";

/**
 * Kampanya kanallarının ortam değişkenleri. Değerler her çağrıda okunur (testler ve yeniden başlatma gerektirmeyen değişiklikler için).
 * Circular'ın Meta uygulaması tanımlı değilse bağlantı ekranı bunu açıkça gösterir; sahte bağlantı kurulmaz.
 */

export const DEFAULT_GRAPH_VERSION = "v26.0";

export function metaConfig() {
  const env = process.env;
  return {
    appId: env.META_APP_ID?.trim() || null,
    appSecret: env.META_APP_SECRET?.trim() || null,
    /** Embedded Signup yapılandırma kimliği (Meta uygulama panelinde oluşturulur) */
    configId: env.WHATSAPP_ES_CONFIG_ID?.trim() || null,
    graphVersion: env.META_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION,
    webhookVerifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || null,
  };
}

/** Mekanın numarasını Meta'nın bağlantı akışıyla bağlamak için gerekenler hazır mı? */
export function embeddedSignupReady(): boolean {
  const c = metaConfig();
  return Boolean(c.appId && c.appSecret && c.configId) && channelSecretReady();
}

/** Geliştirme: Meta'nın test numarasını kimlik ve token girerek bağlama. Canlı ortamda kapalı tutulmalı. */
export function manualConnectAllowed(): boolean {
  return process.env.WHATSAPP_MANUAL_CONNECT === "true" && channelSecretReady();
}

export function channelSecretReady(): boolean {
  return (process.env.CHANNEL_TOKEN_SECRET ?? "").length >= 32;
}

export function webhookUrl(): string {
  const base = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/webhooks/whatsapp`;
}
