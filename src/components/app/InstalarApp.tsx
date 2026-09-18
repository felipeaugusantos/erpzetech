import { useEffect, useState } from "react";
import { Share, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice?: Promise<unknown> };

/**
 * Botão "Instalar no celular". No Android o próprio navegador oferece a
 * instalação (evento beforeinstallprompt); no iPhone mostramos o passo a passo,
 * porque o Safari só instala pelo menu Compartilhar.
 */
export function InstalarApp({ className }: { className?: string }) {
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  const [instalado, setInstalado] = useState(false);
  const [ajuda, setAjuda] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalado(standalone);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as PromptEvent);
    };
    const onInstalado = () => {
      setInstalado(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalado);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalado);
    };
  }, []);

  if (instalado) return null;

  return (
    <>
      <Button
        variant="outline"
        className={className}
        onClick={async () => {
          if (prompt) {
            await prompt.prompt();
            setPrompt(null);
            return;
          }
          setAjuda(true);
        }}
      >
        <Smartphone className="mr-2 size-4" /> Instalar no celular
      </Button>

      <Dialog open={ajuda} onOpenChange={setAjuda}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Instalar o ERP Ze Tech no celular</DialogTitle>
            <DialogDescription>
              Depois de instalar, o atalho abre direto no PDV de venda rápida, em tela cheia.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-semibold">iPhone (Safari)</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>
                  Toque no ícone de compartilhar <Share className="inline size-3.5" /> na barra de
                  baixo.
                </li>
                <li>Escolha “Adicionar à Tela de Início”.</li>
                <li>Confirme em “Adicionar”.</li>
              </ol>
            </div>
            <div>
              <p className="font-semibold">Android (Chrome)</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>Toque no menu de três pontinhos, no canto superior.</li>
                <li>Escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.</li>
                <li>Confirme em “Instalar”.</li>
              </ol>
            </div>
            <p className="text-muted-foreground">
              Abra o sistema pelo endereço publicado da loja para o atalho funcionar fora do
              navegador.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
