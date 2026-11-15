import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function LeitorCodigoCamera({ onCodigo }: { onCodigo: (codigo: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onCodigo);
  callback.current = onCodigo;
  useEffect(() => {
    if (!aberto) return;
    let ativo = true;
    let parar: (() => void) | undefined;
    setErro("");
    async function iniciar() {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (!ativo || !video.current) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          video.current,
          (resultado, _erro, controles) => {
            if (!ativo || !resultado) return;
            ativo = false;
            controles.stop();
            setAberto(false);
            callback.current(resultado.getText());
          },
        );
        parar = () => controls.stop();
        if (!ativo) parar();
      } catch {
        if (ativo)
          setErro(
            "Não foi possível abrir a câmera. Confira a permissão ou use o leitor USB no campo de busca.",
          );
      }
    }
    // O diálogo monta o vídeo após abrir.
    const timer = window.setTimeout(() => void iniciar(), 100);
    return () => {
      ativo = false;
      window.clearTimeout(timer);
      parar?.();
    };
  }, [aberto]);
  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="size-14 shrink-0"
        aria-label="Ler código pela câmera"
        title="Ler código pela câmera"
        onClick={() => setAberto(true)}
      >
        <Camera className="size-5" />
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ler código de barras</DialogTitle>
          </DialogHeader>
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            className="aspect-video w-full rounded-md bg-muted object-cover"
          />
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}
          <Button variant="outline" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
