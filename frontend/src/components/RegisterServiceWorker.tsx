import { useEffect } from "react";

/** Registra o service worker do PWA (cache das ROMs/capas) só no navegador. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Ambiente sem suporte (ex.: navegador privado restrito) - so nao instala.
    });
  }, []);

  return null;
}
