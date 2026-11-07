(function registerPulpitPwa() {
  if (!("serviceWorker" in navigator)) return;

  const isSecure =
    window.isSecureContext ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  if (!isSecure) {
    // LAN HTTP (ej. http://192.168.x.x) no puede registrar SW; en HTTPS/localhost sí.
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* silent: PWA opcional */
    });
  });
})();
