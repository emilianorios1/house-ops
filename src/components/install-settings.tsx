"use client";
import { useEffect, useState } from "react";
type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
type DeviceState = { enabled: boolean; reminders: boolean; movements: boolean };
export function InstallSettings() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [configured, setConfigured] = useState(false);
  const [device, setDevice] = useState<DeviceState>({
    enabled: false,
    reminders: true,
    movements: true,
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const installed = () =>
      setStandalone(
        display.matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone ===
            true,
      );
    installed();
    display.addEventListener("change", installed);
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent));
    setSupported(
      "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window,
    );
    if ("Notification" in window) setPermission(Notification.permission);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => {
      setStandalone(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    let alive = true;
    fetch("/api/push", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((data) => {
        if (alive) {
          setConfigured(data.configured);
          if (data.device) setDevice(data.device);
        }
      })
      .catch(() => {
        if (alive)
          setMessage(
            "No pudimos consultar los avisos. Recargá para volver a intentar.",
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      display.removeEventListener("change", installed);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  async function request(body: object, method = "POST") {
    const response = await fetch("/api/push", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw Error(data.error || "No pudimos guardar. Probá otra vez.");
    return data;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No pudimos guardar. Probá otra vez.",
      );
    } finally {
      setBusy(false);
      if ("Notification" in window) setPermission(Notification.permission);
    }
  }
  async function enable() {
    // Request permission directly inside the tap, as required on iOS.
    const allowed = await Notification.requestPermission();
    setPermission(allowed);
    if (allowed !== "granted") {
      setMessage(
        "Los avisos no están permitidos. Podés cambiarlos en los ajustes del teléfono.",
      );
      return;
    }
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;
    const response = await fetch("/api/push", { cache: "no-store" });
    if (!response.ok) throw Error("No pudimos activar los avisos.");
    const data = await response.json();
    if (!data.publicKey)
      throw Error("Los avisos todavía no están configurados.");
    const key = Uint8Array.from(
      atob(data.publicKey.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    // Replace an old subscription after logout or a change of household account.
    const old = await registration.pushManager.getSubscription();
    if (old) await old.unsubscribe();
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    try {
      const result = await request({ subscription: sub.toJSON() });
      setDevice(result.device);
    } catch (error) {
      await sub.unsubscribe();
      throw error;
    }
    setMessage("Listo. Los avisos están activados en este teléfono.");
  }
  async function disable() {
    await request({}, "DELETE");
    setDevice((d) => ({ ...d, enabled: false }));
    const registration = await navigator.serviceWorker.getRegistration();
    await (await registration?.pushManager.getSubscription())?.unsubscribe();
    setMessage("Desactivaste los avisos en este teléfono.");
  }
  async function preference(key: "reminders" | "movements", value: boolean) {
    const previous = device;
    setDevice((current) => ({ ...current, [key]: value }));
    try {
      const result = await request({ [key]: value }, "PATCH");
      setDevice(result.device);
      setMessage("Guardamos tu preferencia.");
    } catch (error) {
      setDevice(previous);
      throw error;
    }
  }
  return (
    <div className="install-grid">
      <section className="card install-card">
        <span className="eyebrow">EN TU TELÉFONO</span>
        <h2>{standalone ? "Casa ya está instalada" : "Instalá Casa"}</h2>
        <p>Abrila desde su ícono, con tus mismos gastos y comprobantes.</p>
        {!standalone &&
          (ios ? (
            <ol>
              <li>Abrí Casa en Safari.</li>
              <li>
                Tocá <strong>Compartir</strong> y después{" "}
                <strong>Agregar a pantalla de inicio</strong>.
              </li>
              <li>Abrila desde el nuevo ícono para activar los avisos.</li>
            </ol>
          ) : (
            <>
              <p>
                En Chrome para Android, abrí el menú ⋮ y elegí{" "}
                <strong>Instalar aplicación</strong> o{" "}
                <strong>Agregar a pantalla de inicio</strong>.
              </p>
              {prompt && (
                <button
                  className="button primary"
                  onClick={() =>
                    void run(async () => {
                      await prompt.prompt();
                      await prompt.userChoice;
                      setPrompt(null);
                    })
                  }
                  disabled={busy}
                >
                  Instalar Casa
                </button>
              )}
            </>
          ))}
        <p className="help">
          Necesitás internet para consultar y guardar gastos.
        </p>
      </section>
      <section className="card install-card">
        <span className="eyebrow">SIN TENER QUE ACORDARTE</span>
        <h2>Avisos en este teléfono</h2>
        <p>
          Facturas por vencer a las 9:00 de Argentina, el día anterior y ese
          día. También, pagos y reintegros que registre el otro.
        </p>
        <p className="help">
          Los avisos muestran servicios e importes, incluso con la pantalla
          bloqueada. La llegada depende de la conexión y los ajustes del
          teléfono.
        </p>
        {loading ? (
          <p role="status">Consultando avisos…</p>
        ) : !configured ? (
          <p className="notice">
            Los avisos todavía no están configurados en esta instalación. Podés
            instalar y usar Casa igualmente.
          </p>
        ) : ios && !standalone ? (
          <p className="notice">
            Primero agregá Casa a la pantalla de inicio y abrila desde su ícono.
            Los avisos requieren iOS 16.4 o posterior.
          </p>
        ) : !supported ? (
          <p className="notice">
            Este navegador no admite avisos. Usá Chrome en Android o Casa
            instalada desde Safari en un iPhone actualizado.
          </p>
        ) : (
          <>
            <p>
              <strong>
                {permission === "denied"
                  ? "Permiso bloqueado"
                  : device.enabled && permission === "granted"
                    ? "Avisos activados"
                    : "Avisos desactivados"}
              </strong>
            </p>
            {permission === "denied" ? (
              <p>
                Habilitá las notificaciones de Casa desde los ajustes del
                teléfono o los permisos del sitio. Después volvé a abrir Casa.
              </p>
            ) : !device.enabled || permission !== "granted" ? (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void run(enable)}
              >
                Activar avisos
              </button>
            ) : (
              <>
                <label className="notification-choice">
                  <input
                    type="checkbox"
                    checked={device.reminders}
                    disabled={busy}
                    onChange={(e) =>
                      void run(() => preference("reminders", e.target.checked))
                    }
                  />
                  Facturas por vencer
                </label>
                <label className="notification-choice">
                  <input
                    type="checkbox"
                    checked={device.movements}
                    disabled={busy}
                    onChange={(e) =>
                      void run(() => preference("movements", e.target.checked))
                    }
                  />
                  Pagos y reintegros del otro
                </label>
                <div className="install-actions">
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await request({ action: "test" });
                        setMessage(
                          "Preparamos el aviso de prueba. Debería llegar en aproximadamente un minuto.",
                        );
                      })
                    }
                  >
                    Enviar aviso de prueba
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void run(disable)}
                  >
                    Desactivar avisos
                  </button>
                </div>
              </>
            )}
            {permission === "denied" && device.enabled && (
              <button
                className="button"
                disabled={busy}
                onClick={() => void run(disable)}
              >
                Desactivar avisos
              </button>
            )}
          </>
        )}
        <p role="status" aria-live="polite">
          {busy ? "Un momento…" : message}
        </p>
      </section>
    </div>
  );
}
