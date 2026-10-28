import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { dateTimeBR } from "@/lib/format";
import {
  FOTOS_POR_MOMENTO,
  MOMENTOS_FOTO,
  erroDaFoto,
  nomeDaFotoReduzida,
  reduzirFoto,
  type MomentoFoto,
} from "@/lib/lava-fotos";
import { formatarIdentificacao } from "@/lib/lava-rapido";

const BUCKET = "lava-fotos";

type Foto = {
  id: string;
  momento: MomentoFoto;
  nome_arquivo: string;
  caminho: string;
  created_at: string;
  pode_cancelar: boolean;
};

/**
 * Fotos de antes e depois da lavagem. O banco reserva o caminho antes do envio e confere o arquivo depois;
 * a foto não se apaga (só se cancela com motivo) e abre por link temporário.
 */
export function FotosOrdem({
  ordemId,
  veiculo,
  onFechar,
}: {
  ordemId: string;
  veiculo: { tipo: string; identificacao: string };
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const entradas = useRef<Record<MomentoFoto, HTMLInputElement | null>>({
    antes: null,
    depois: null,
  });
  const [enviando, setEnviando] = useState<MomentoFoto | null>(null);
  const [cancelando, setCancelando] = useState<Foto | null>(null);
  const [motivo, setMotivo] = useState("");

  const { data: fotos = [], isLoading } = useQuery({
    queryKey: ["lava-fotos", ordemId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("lr_fotos_da_ordem", { p_ordem_id: ordemId });
      if (error) throw error;
      const lista = (data ?? []) as unknown as Foto[];
      if (lista.length === 0) return [];
      // links temporários de 5 minutos: a lista é recarregada ao abrir a tela
      const { data: links } = await supabase.storage.from(BUCKET).createSignedUrls(
        lista.map((f) => f.caminho),
        300,
      );
      return lista.map((f) => ({
        ...f,
        url: links?.find((l) => l.path === f.caminho)?.signedUrl ?? null,
      }));
    },
  });

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["lava-fotos", ordemId] });
    void qc.invalidateQueries({ queryKey: ["lava-patio"] });
  };

  async function enviar(momento: MomentoFoto, arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    setEnviando(momento);
    try {
      for (const arquivo of Array.from(arquivos)) {
        const erro = erroDaFoto(arquivo);
        if (erro) throw new Error(`${arquivo.name}: ${erro}`);
        let blob: Blob;
        try {
          blob = await reduzirFoto(arquivo);
        } catch {
          throw new Error(`${arquivo.name}: não foi possível ler a foto neste aparelho`);
        }
        const nome = nomeDaFotoReduzida(arquivo.name);
        const { data: reserva, error: e1 } = await supabase.rpc("lr_foto_preparar", {
          p_ordem_id: ordemId,
          p_momento: momento,
          p_nome_arquivo: nome,
          p_mime: "image/jpeg",
          p_tamanho: blob.size,
        });
        if (e1) throw e1;
        const { id, caminho } = reserva as unknown as { id: string; caminho: string };
        const up = await supabase.storage
          .from(BUCKET)
          .upload(caminho, blob, { contentType: "image/jpeg", upsert: false });
        if (up.error) throw up.error;
        const { error: e3 } = await supabase.rpc("lr_foto_confirmar", { p_id: id });
        if (e3) throw e3;
      }
      toast.success(arquivos.length === 1 ? "Foto enviada." : "Fotos enviadas.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(null);
      for (const m of Object.values(entradas.current)) if (m) m.value = "";
      atualizar();
    }
  }

  const cancelar = useMutation({
    mutationFn: async () => {
      if (!cancelando) return;
      const { error } = await supabase.rpc("lr_foto_cancelar", {
        p_id: cancelando.id,
        p_motivo: motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Foto cancelada.");
      setCancelando(null);
      setMotivo("");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Fotos — {formatarIdentificacao(veiculo.tipo, veiculo.identificacao)}
          </DialogTitle>
        </DialogHeader>

        {MOMENTOS_FOTO.map((m) => {
          const doMomento = fotos.filter((f) => f.momento === m.value);
          return (
            <section key={m.value} aria-label={m.label} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {m.label}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({doMomento.length} de {FOTOS_POR_MOMENTO})
                  </span>
                </h3>
                <div>
                  <input
                    ref={(el) => {
                      entradas.current[m.value] = el;
                    }}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    className="sr-only"
                    id={`foto-${m.value}`}
                    onChange={(e) => void enviar(m.value, e.target.files)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={enviando !== null || doMomento.length >= FOTOS_POR_MOMENTO}
                    onClick={() => entradas.current[m.value]?.click()}
                  >
                    <Camera className="size-4" />{" "}
                    {enviando === m.value ? "Enviando…" : "Adicionar foto"}
                  </Button>
                </div>
              </div>
              {isLoading ? (
                <div className="h-20 animate-pulse rounded-md bg-muted" />
              ) : doMomento.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma foto.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {doMomento.map((f) => (
                    <li key={f.id} className="relative overflow-hidden rounded-md border">
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={f.url}
                            alt={`${m.label}: ${f.nome_arquivo}`}
                            loading="lazy"
                            className="aspect-[4/3] w-full object-cover"
                          />
                        </a>
                      ) : (
                        <div className="grid aspect-[4/3] place-items-center text-xs text-muted-foreground">
                          Sem pré-visualização
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-1 p-1 text-xs text-muted-foreground">
                        <span>{dateTimeBR(f.created_at)}</span>
                        {f.pode_cancelar && (
                          <button
                            type="button"
                            aria-label={`Cancelar foto ${f.nome_arquivo}`}
                            className="hover:text-destructive"
                            onClick={() => setCancelando(f)}
                          >
                            <XCircle className="size-4" />
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {cancelando && (
          <div className="space-y-2 rounded-md border border-destructive/40 p-3">
            <Label htmlFor="foto-motivo">Motivo do cancelamento</Label>
            <Input
              id="foto-motivo"
              value={motivo}
              placeholder="Ex.: foto de outro veículo"
              onChange={(e) => setMotivo(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              A foto sai da lista, mas continua no registro: não é apagada.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setCancelando(null)}>
                Voltar
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={cancelar.isPending}
                onClick={() => cancelar.mutate()}
              >
                Cancelar foto
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
