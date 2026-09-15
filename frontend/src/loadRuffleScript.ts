let loadPromise: Promise<void> | null = null;

export function loadRuffleScript(): Promise<void> {
  if (window.RufflePlayer) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/ruffle/ruffle.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Falha ao carregar o Ruffle"));
    document.body.appendChild(script);
  });

  return loadPromise;
}
