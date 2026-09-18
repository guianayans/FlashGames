import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

type ScanState = "requesting" | "scanning" | "denied" | "error";

// Escaneia o QR code de pareamento (ver RemoteControlContext) DE DENTRO
// do proprio app — em vez de abrir a camera do celular (que sempre abre
// no navegador, nunca no PWA instalado, mesmo problema em qualquer
// plataforma mas principalmente grave no iOS, que nao tem NENHUMA forma
// programatica de abrir um app instalado a partir de um link externo).
// Escaneando aqui dentro, a navegacao pro /remote/<token> decodificado
// acontece originada de DENTRO do PWA ja' rodando em modo standalone —
// fica dentro dele, sem nunca precisar do navegador externo.
export default function QrScannerModal({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const [state, setState] = useState<ScanState>("requesting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setState("scanning");
        tick();
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") setState("denied");
        else setState("error");
        setError(err instanceof Error ? err.message : "Erro ao acessar a câmera");
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
      if (code && code.data) {
        handleDecoded(code.data);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    function handleDecoded(text: string) {
      // So navega se for um link de pareamento de VERDADE, da MESMA
      // origem — um QR code e' entrada de fora, nunca confia direto
      // (podia ser qualquer coisa apontando pra fora).
      let url: URL;
      try {
        url = new URL(text, window.location.origin);
      } catch {
        setError("QR code inválido.");
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (url.origin !== window.location.origin || !/^\/remote\/[^/]+$/.test(url.pathname)) {
        setError("Esse QR code não é de um pareamento do FlashGames.");
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      // Navegacao de PAGINA de verdade (nao React Router) de proposito —
      // /remote/<token> e' o RemoteController.html estatico, fora do SPA.
      // Como parte do MESMO PWA (mesma origem, dentro do scope do
      // manifest), continua rodando standalone, sem abrir navegador
      // nenhum por fora.
      window.location.href = url.pathname;
    }

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="qr-scanner-card" onClick={(e) => e.stopPropagation()}>
        <h2>Ler QR Code</h2>
        {state === "denied" && (
          <p className="qr-scanner-error">
            Sem acesso à câmera. Permita o acesso nas configurações do navegador/app e tente de novo.
          </p>
        )}
        {state === "error" && <p className="qr-scanner-error">{error || "Não deu pra abrir a câmera."}</p>}
        <div className={`qr-scanner-video-wrap${state === "scanning" ? " ready" : ""}`}>
          <video ref={videoRef} className="qr-scanner-video" playsInline muted />
          <div className="qr-scanner-frame" />
        </div>
        <canvas ref={canvasRef} style={{ display: "none" }} />
        {error && state === "scanning" && <p className="qr-scanner-error">{error}</p>}
        <p className="qr-scanner-hint">Aponte a câmera pro QR code que apareceu no desktop.</p>
        <button type="button" className="remote-pairing-close" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
