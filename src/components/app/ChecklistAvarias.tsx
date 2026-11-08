import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Trash2, XCircle } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CroquiVeiculo } from "@/components/app/CroquiVeiculo";
import { dateTimeBR } from "@/lib/format";
import {
  TIPOS_AVARIA,
  estadoDoChecklist,
  formatarIdentificacao,
  locaisDeAvaria,
  rotuloAvaria,
} from "@/lib/lava-rapido";
import { supabase } from "@/integrations/supabase/client";
import {
  FOTOS_POR_AVARIA,
  enviarFotoDaOrdem,
  listarFotosDaOrdem,
  type FotoDaOrdem,
} from "@/lib/lava-fotos-envio";

export type AvariaLinha = {
  id: string;
  lugar: string;
  tipo: string;
  descricao: string | null;
};

type OrdemChecklist = {
  id: string;
  checklist_em: string | null;
  checklist_sem_avarias: boolean | null;
};

/**
 * Checklist de avarias na entrada do veículo: a recepção registra o que já existe ou confirma que não há nada.
 * Depois de concluído, o que foi registrado não se apaga (o banco também confere).
 */
export function ChecklistAvarias({
  ordem,
  veiculo,
  avarias,
  onFechar,
}: {
  ordem: OrdemChecklist;
  veiculo: { tipo: string; identificacao: string };
  avarias: AvariaLinha[];
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [lugar, setLugar] = useState("");
  const [tipo, setTipo] = useState("risco");
  const [descricao, setDescricao] = useState("");
  const entradaFoto = useRef<HTMLInputElement | null>(null);
  const [avariaDaFoto, setAvariaDaFoto] = useState<string | null>(null);
  const [enviandoDe, setEnviandoDe] = useState<string | null>(null);
  const [fotoCancelar, setFotoCancelar] = useState<FotoDaOrdem | null>(null);
  const [motivo, setMotivo] = useState("");
  const estado = estadoDoChecklist(ordem);
  const concluido = estado !== "pendente";
  const atualizar = () => void qc.invalidateQueries({ queryKey: ["lava-patio"] });

  // links de 60 s: a lista é renovada antes de expirar (uma foto cancelada deixa de abrir em até um minuto)
  const { data: fotos = [] } = useQuery({
    queryKey: ["lava-fotos-avarias", ordem.id],
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 50_000,
    queryFn: async () => (await listarFotosDaOrdem(ordem.id)).filter((f) => f.avaria_id !== null),
  });
  const atualizarFotos = () =>
    void qc.invalidateQueries({ queryKey: ["lava-fotos-avarias", ordem.id] });

  async function enviarFotos(avariaId: string, arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    setEnviandoDe(avariaId);
    try {
      for (const arquivo of Array.from(arquivos))
        await enviarFotoDaOrdem(ordem.id, "antes", arquivo, avariaId);
      toast.success(arquivos.length === 1 ? "Foto enviada." : "Fotos enviadas.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviandoDe(null);
      if (entradaFoto.current) entradaFoto.current.value = "";
      atualizarFotos();
    }
  }

  const cancelarFoto = useMutation({
    mutationFn: async () => {
      if (!fotoCancelar) return;
      const { error } = await supabase.rpc("lr_foto_cancelar", {
        p_id: fotoCancelar.id,
        p_motivo: motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Foto cancelada.");
      setFotoCancelar(null);
      setMotivo("");
      atualizarFotos();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const registrar = useMutation({
    mutationFn: async () => {
      if (lugar.trim().length < 2) throw new Error("Informe o local da avaria.");
      const { error } = await supabase.rpc("lr_avaria_registrar", {
        p_ordem_id: ordem.id,
        p_local: lugar.trim(),
        p_tipo: tipo,
        ...(descricao.trim() ? { p_descricao: descricao.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setLugar("");
      setDescricao("");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("lr_avaria_remover", { p_id: id });
      if (error) throw error;
    },
    onSuccess: atualizar,
    onError: (e: Error) => toast.error(e.message),
  });

  const concluir = useMutation({
    mutationFn: async (semAvarias: boolean) => {
      const { error } = await supabase.rpc("lr_checklist_concluir", {
        p_ordem_id: ordem.id,
        p_sem_avarias: semAvarias,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Checklist concluído.");
      atualizar();
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Checklist de avarias — {formatarIdentificacao(veiculo.tipo, veiculo.identificacao)}
          </DialogTitle>
        </DialogHeader>

        {concluido && (
          <p className="rounded-md bg-secondary px-3 py-2 text-sm">
            Checklist concluído em {dateTimeBR(ordem.checklist_em)}.{" "}
            {estado === "sem_avarias"
              ? "O veículo entrou sem avarias."
              : "As avarias registradas não se apagam."}
          </p>
        )}

        {avarias.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma avaria registrada.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {avarias.map((a) => {
              const fotosDa = fotos.filter((f) => f.avaria_id === a.id);
              return (
                <li key={a.id} className="grid gap-2 p-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span>
                      <strong>{a.lugar}</strong> · {rotuloAvaria(a.tipo)}
                      {a.descricao ? (
                        <span className="block text-muted-foreground">{a.descricao}</span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Adicionar foto da avaria em ${a.lugar}`}
                        disabled={enviandoDe !== null || fotosDa.length >= FOTOS_POR_AVARIA}
                        onClick={() => {
                          setAvariaDaFoto(a.id);
                          entradaFoto.current?.click();
                        }}
                      >
                        <Camera className="size-4" />{" "}
                        {enviandoDe === a.id ? "Enviando…" : `Foto (${fotosDa.length}/${FOTOS_POR_AVARIA})`}
                      </Button>
                      {!concluido && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remover avaria em ${a.lugar}`}
                          disabled={remover.isPending}
                          onClick={() => remover.mutate(a.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </span>
                  </div>
                  {fotosDa.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {fotosDa.map((f) => (
                        <li key={f.id} className="relative">
                          {f.url ? (
                            <a href={f.url} target="_blank" rel="noopener noreferrer">
                              <img
                                src={f.url}
                                alt={`Foto da avaria em ${a.lugar}`}
                                loading="lazy"
                                className="size-16 rounded-md border object-cover"
                              />
                            </a>
                          ) : (
                            <div className="grid size-16 place-items-center rounded-md border text-[10px] text-muted-foreground">
                              Sem prévia
                            </div>
                          )}
                          {f.pode_cancelar && (
                            <button
                              type="button"
                              aria-label={`Cancelar foto da avaria em ${a.lugar}`}
                              className="absolute -right-1 -top-1 rounded-full bg-background text-muted-foreground hover:text-destructive"
                              onClick={() => setFotoCancelar(f)}
                            >
                              <XCircle className="size-4" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <input
          ref={entradaFoto}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          aria-label="Escolher foto da avaria"
          onChange={(e) => avariaDaFoto && void enviarFotos(avariaDaFoto, e.target.files)}
        />

        {fotoCancelar && (
          <div className="space-y-2 rounded-md border border-destructive/40 p-3">
            <Label htmlFor="av-foto-motivo">Motivo do cancelamento da foto</Label>
            <Input
              id="av-foto-motivo"
              value={motivo}
              placeholder="Ex.: foto de outro veículo"
              onChange={(e) => setMotivo(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              A foto sai da lista, mas continua no registro: não é apagada.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setFotoCancelar(null)}>
                Voltar
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={cancelarFoto.isPending}
                onClick={() => cancelarFoto.mutate()}
              >
                Cancelar foto
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-3 border-t pt-3">
          <p className="text-sm font-medium">
            {concluido ? "Avaria achada depois" : "Registrar avaria"}
          </p>
          <CroquiVeiculo
            tipo={veiculo.tipo}
            selecionado={lugar}
            onEscolher={setLugar}
            avarias={avarias}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="av-lugar">Local</Label>
              <Input
                id="av-lugar"
                list="av-sugestoes"
                value={lugar}
                placeholder="Ex.: Capô"
                onChange={(e) => setLugar(e.target.value)}
              />
              <datalist id="av-sugestoes">
                {locaisDeAvaria(veiculo.tipo).map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>
            <div>
              <Label htmlFor="av-tipo">Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger id="av-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_AVARIA.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="av-desc">Descrição (opcional)</Label>
            <Input
              id="av-desc"
              value={descricao}
              maxLength={300}
              placeholder="Ex.: risco de uns 10 cm"
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={registrar.isPending}
              onClick={() => registrar.mutate()}
            >
              Adicionar avaria
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
          {!concluido &&
            (avarias.length === 0 ? (
              <Button disabled={concluir.isPending} onClick={() => concluir.mutate(true)}>
                Concluir: sem avarias
              </Button>
            ) : (
              <Button disabled={concluir.isPending} onClick={() => concluir.mutate(false)}>
                Concluir com {avarias.length} {avarias.length === 1 ? "avaria" : "avarias"}
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
