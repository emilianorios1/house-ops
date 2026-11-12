/* No financial responses or documents are cached, including navigations. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate" || event.request.method !== "GET") return;
  event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Casa · Sin conexión</title><body style="background:#f7f8f5;color:#263c35;font:18px system-ui;padding:48px 24px"><h1>Casa está sin conexión</h1><p>Conectate a internet para ver y guardar tus gastos.</p><p>Tus datos siguen guardados en Casa.</p><a href="/">Volver a intentar</a></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })));
});
self.addEventListener("push", event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { return; }
  const url = typeof data.url === "string" && /^\/\?month=\d{4}-\d{2}$/.test(data.url) ? data.url : "/";
  event.waitUntil(self.registration.showNotification(String(data.title || "Casa"), { body: String(data.body || "Tenés novedades en Casa."), icon: "/icon-192.png", badge: "/badge.png", tag: String(data.tag || "casa"), data: { url } }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
    const client = clients.find(c => new URL(c.url).origin === self.location.origin);
    if (client) { await client.navigate(url.href); return client.focus(); }
    return self.clients.openWindow(url.href);
  }));
});
