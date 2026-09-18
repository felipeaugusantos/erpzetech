import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { ZeLogo } from "@/components/app/ZeLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BUCKET = "empresa";
const MAX_BYTES = 3 * 1024 * 1024;
const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];

/** Cor padrão da marca ERP Ze Tech, usada quando a loja não escolheu uma cor. */
export const COR_PADRAO = "#008037";

/** Converte o caminho guardado na empresa em uma URL temporária de leitura. */
export function useLogoUrl(caminho: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    if (!caminho) {
      setUrl(null);
      return;
    }
    if (caminho.startsWith("http")) {
      setUrl(caminho);
      return;
    }
    void supabase.storage
      .from(BUCKET)
      .createSignedUrl(caminho, 3600)
      .then(({ data }) => {
        if (ativo) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      ativo = false;
    };
  }, [caminho]);

  return url;
}

function hexValido(cor: string | null | undefined) {
  return typeof cor === "string" && /^#[0-9a-fA-F]{6}$/.test(cor);
}

/** Clareia ou escurece um hex; fator negativo escurece. */
function ajustar(cor: string, fator: number) {
  const n = parseInt(cor.slice(1), 16);
  const canal = (v: number) => {
    const alvo = fator >= 0 ? 255 : 0;
    return Math.round(v + (alvo - v) * Math.abs(fator));
  };
  const r = canal((n >> 16) & 255);
  const g = canal((n >> 8) & 255);
  const b = canal(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Texto legível sobre a cor escolhida. */
function contraste(cor: string) {
  const n = parseInt(cor.slice(1), 16);
  const lum =
    (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#0b1f14" : "#ffffff";
}

/** Aplica a cor da empresa nas variáveis de tema do sistema. */
export function aplicarCorEmpresa(cor: string | null | undefined) {
  if (typeof document === "undefined") return;
  const raiz = document.documentElement;
  const base = hexValido(cor) ? cor! : COR_PADRAO;
  const fg = contraste(base);
  raiz.style.setProperty("--primary", base);
  raiz.style.setProperty("--primary-foreground", fg);
  raiz.style.setProperty("--ring", base);
  raiz.style.setProperty("--sidebar", ajustar(base, -0.55));
  raiz.style.setProperty("--sidebar-primary", ajustar(base, 0.25));
  raiz.style.setProperty("--sidebar-primary-foreground", ajustar(base, -0.7));
}

/** Mantém a cor da loja aplicada em toda a navegação. */
export function useTemaEmpresa() {
  const { data: session } = useSessionData();
  const cor = session?.empresa?.cor_primaria ?? null;

  useEffect(() => {
    aplicarCorEmpresa(cor);
  }, [cor]);
}

/** Mostra a logo da loja quando cadastrada; senão usa o ícone do ERP Ze Tech. */
export function LogoEmpresa({ className }: { className?: string }) {
  const { data: session } = useSessionData();
  const url = useLogoUrl(session?.empresa?.logo_path ?? null);
  const nome = session?.empresa?.nome_fantasia ?? session?.empresa?.razao_social ?? "ERP Ze Tech";

  if (!url) return <ZeLogo {...(className ? { className } : {})} />;

  return (
    <span className={cn("grid size-9 shrink-0 place-items-center overflow-hidden", className)}>
      <img src={url} alt={nome} className="size-full object-contain" />
    </span>
  );
}

/** Envio e remoção da logo da empresa. */
export function LogoEmpresaUpload({
  caminho,
  tenantId,
  podeEditar,
  onChange,
}: {
  caminho: string | null;
  tenantId: string | null | undefined;
  podeEditar: boolean;
  onChange: (caminho: string | null) => void;
}) {
  const url = useLogoUrl(caminho);
  const [enviando, setEnviando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const enviar = async (arquivo: File) => {
    if (!TIPOS.includes(arquivo.type)) {
      toast.error("Use uma imagem JPG, PNG, WEBP ou SVG.");
      return;
    }
    if (arquivo.size > MAX_BYTES) {
      toast.error("A logo deve ter até 3 MB.");
      return;
    }
    if (!tenantId) {
      toast.error("Cadastre a empresa antes de enviar a logo.");
      return;
    }
    setEnviando(true);
    const ext = arquivo.name.split(".").pop()?.toLowerCase() ?? "png";
    const nome = `${tenantId}/logo-${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(nome, arquivo, {
      contentType: arquivo.type,
      upsert: false,
    });
    setEnviando(false);
    if (error) {
      toast.error("Não foi possível enviar a logo", { description: error.message });
      return;
    }
    onChange(nome);
    toast.success("Logo enviada. Salve a empresa para confirmar.");
  };

  return (
    <div className="flex items-center gap-3 rounded-md border border-border p-3">
      {url ? (
        <img
          src={url}
          alt="Logo da empresa"
          className="size-20 rounded-md border border-border bg-white object-contain p-1"
        />
      ) : (
        <div className="flex size-20 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
          <ImagePlus className="size-5" />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) void enviar(arquivo);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!podeEditar || enviando}
          onClick={() => input.current?.click()}
        >
          {enviando ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          {caminho ? "Trocar logo" : "Enviar logo"}
        </Button>
        {caminho && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!podeEditar}
            onClick={() => onChange(null)}
          >
            <Trash2 className="size-4" />
            Remover
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          JPG, PNG, WEBP ou SVG até 3 MB. Aparece no menu, na entrada e nas impressões.
        </p>
      </div>
    </div>
  );
}
