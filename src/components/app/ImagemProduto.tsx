import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const BUCKET = "produtos";
const MAX_BYTES = 5 * 1024 * 1024;
const TIPOS = ["image/jpeg", "image/png", "image/webp"];

/** Converte o caminho guardado no produto em uma URL temporária de leitura. */
export function useImagemUrl(caminho: string | null | undefined) {
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

export function MiniaturaProduto({
  caminho,
  alt,
}: {
  caminho: string | null | undefined;
  alt: string;
}) {
  const url = useImagemUrl(caminho);
  if (!url) return null;
  return (
    <img
      src={url}
      alt={alt}
      className="size-10 shrink-0 rounded-md border border-border object-cover"
    />
  );
}

export function ImagemProduto({
  caminho,
  onChange,
  tenantId,
}: {
  caminho: string | null;
  onChange: (caminho: string | null) => void;
  tenantId: string | null | undefined;
}) {
  const url = useImagemUrl(caminho);
  const [enviando, setEnviando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const enviar = async (arquivo: File) => {
    if (!TIPOS.includes(arquivo.type)) {
      toast.error("Use uma imagem JPG, PNG ou WEBP.");
      return;
    }
    if (arquivo.size > MAX_BYTES) {
      toast.error("A imagem deve ter até 5 MB.");
      return;
    }
    if (!tenantId) {
      toast.error("Usuário sem empresa vinculada.");
      return;
    }
    setEnviando(true);
    const ext = arquivo.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const nome = `${tenantId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(nome, arquivo, {
      contentType: arquivo.type,
      upsert: false,
    });
    setEnviando(false);
    if (error) {
      toast.error("Não foi possível enviar a imagem", { description: error.message });
      return;
    }
    onChange(nome);
    toast.success("Imagem enviada. Salve o produto para confirmar.");
  };

  return (
    <div className="flex items-center gap-3 rounded-md border border-border p-3">
      {url ? (
        <img
          src={url}
          alt="Foto do produto"
          className="size-20 rounded-md border border-border object-cover"
        />
      ) : (
        <div className="flex size-20 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
          <ImagePlus className="size-5" />
        </div>
      )}
      <div className="space-y-2">
        <p className="text-sm font-medium">Foto do produto</p>
        <p className="text-xs text-muted-foreground">JPG, PNG ou WEBP, até 5 MB.</p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={enviando}
            onClick={() => input.current?.click()}
          >
            {enviando ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {caminho ? "Trocar imagem" : "Enviar imagem"}
          </Button>
          {caminho && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <Trash2 className="mr-2 size-4" /> Remover
            </Button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            e.target.value = "";
            if (arquivo) void enviar(arquivo);
          }}
        />
      </div>
    </div>
  );
}
