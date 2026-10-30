import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";

import { ManufaturaBloqueada } from "@/components/app/ManufaturaBloqueada";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
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
import { useManufatura } from "@/hooks/useManufatura";
import { supabase } from "@/integrations/supabase/client";
import { dateBR } from "@/lib/format";
import {
  PERFIS_APONTAMENTO,
  erroDoApontamento,
  SITUACAO_ORDEM,
  formatarMinutos,
  formatarQuantidadeMf,
  novaChaveApontamento,
  type SituacaoOrdem,
} from "@/lib/manufatura";

export const Route = createFileRoute("/_authenticated/manufatura-apontar")({
  head: () => ({
    meta: [
      { title: "Apontamento de produção — EZRA ERP" },
      {
        name: "description",
        content:
          "Registre o que foi produzido e o refugo de cada ordem, direto do chão de fábrica.",
      },
    ],
  }),
  component: ApontarModulo,
});

function ApontarModulo() {
  const m = useManufatura();
  if (m.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!m.liberada) return <ManufaturaBloqueada motivo="modulo" />;
  if (!m.temPerfil(PERFIS_APONTAMENTO)) return <ManufaturaBloqueada motivo="perfil" />;
  return <Apontar />;
}

type Ordem = {
  id: string;
  numero: number;
  descricao: string;
  produto: string | null;
  quantidade_planejada: number;
  quantidade_produzida: number;
  quantidade_refugo: number;
  situacao: string;
  prazo: string | null;
  medidas: string | null;
  acabamento: string | null;
};

const SEM_ETAPA = "sem-etapa";
const numero = (t: string) => Number((t || "0").replace(",", "."));

function Apontar() {
  const qc = useQueryClient();
  const [alvo, setAlvo] = useState<Ordem | null>(null);
  const [boa, setBoa] = useState("");
  const [refugo, setRefugo] = useState("");
  const [minutos, setMinutos] = useState("");
  const [etapaId, setEtapaId] = useState(SEM_ETAPA);
  // a mesma chave vale para repetir o envio (rede ruim, duplo clique): o banco não consome duas vezes
  const [chave, setChave] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["mf-ordens-producao"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("mf_ordens_producao");
      if (error) throw error;
      return (data ?? []) as Ordem[];
    },
  });

  const { data: etapas } = useQuery({
    queryKey: ["mf-ordem-etapas-producao", alvo?.id],
    enabled: alvo !== null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("mf_ordem_etapas_producao", {
        p_ordem_id: alvo!.id,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: insumos } = useQuery({
    queryKey: ["mf-ordem-insumos-producao", alvo?.id],
    enabled: alvo !== null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("mf_ordem_insumos_producao", {
        p_ordem_id: alvo!.id,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  function abrir(o: Ordem) {
    setAlvo(o);
    setEtapaId(SEM_ETAPA);
    setBoa("");
    setRefugo("");
    setMinutos("");
    setChave(novaChaveApontamento());
  }

  const apontar = useMutation({
    mutationFn: async () => {
      if (!alvo) return;
      const b = numero(boa);
      const r = numero(refugo);
      const min = minutos.trim() === "" ? null : Math.round(numero(minutos));
      const erro = erroDoApontamento({
        boa: b,
        refugo: r,
        minutos: min,
        etapaId: etapaId === SEM_ETAPA ? null : etapaId,
      });
      if (erro) throw new Error(erro);
      const { error } = await supabase.rpc("mf_ordem_apontar", {
        p_ordem_id: alvo.id,
        p_boa: b,
        p_refugo: r,
        p_minutos: min,
        p_chave: chave,
        ...(etapaId !== SEM_ETAPA ? { p_etapa_id: etapaId } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Apontamento registrado.");
      setAlvo(null);
      void qc.invalidateQueries({ queryKey: ["mf-ordens-producao"] });
      void qc.invalidateQueries({ queryKey: ["mf-ordem-etapas-producao"] });
      void qc.invalidateQueries({ queryKey: ["mf-ordens"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Apontamento de produção"
        description="Registre o que foi produzido e o refugo. Os insumos saem do estoque sozinhos."
      />

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState
          title="Nenhuma ordem para apontar"
          description="As ordens aparecem aqui quando são liberadas pela gestão."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data!.map((o) => {
            const sit = o.situacao as SituacaoOrdem;
            const pct = Math.min(
              100,
              Math.round(
                (Number(o.quantidade_produzida) / Math.max(Number(o.quantidade_planejada), 0.001)) *
                  100,
              ),
            );
            return (
              <div key={o.id} className="panel flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display text-base font-semibold">
                      OP-{o.numero} · {o.descricao}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {o.produto ? `${o.produto} · ` : ""}
                      {o.prazo ? `prazo ${dateBR(o.prazo)}` : "sem prazo"}
                    </p>
                    {(o.medidas || o.acabamento) && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {o.medidas ? `Medidas: ${o.medidas}` : ""}
                        {o.medidas && o.acabamento ? " · " : ""}
                        {o.acabamento ? `Acabamento: ${o.acabamento}` : ""}
                      </p>
                    )}
                  </div>
                  <Badge variant={sit === "em_producao" ? "default" : "secondary"}>
                    {SITUACAO_ORDEM[sit] ?? o.situacao}
                  </Badge>
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      {formatarQuantidadeMf(Number(o.quantidade_produzida))} de{" "}
                      {formatarQuantidadeMf(Number(o.quantidade_planejada))} produzidas
                    </span>
                    {Number(o.quantidade_refugo) > 0 && (
                      <span className="text-muted-foreground">
                        refugo {formatarQuantidadeMf(Number(o.quantidade_refugo))}
                      </span>
                    )}
                  </div>
                  <div
                    className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Progresso da OP-${o.numero}`}
                  >
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <Button onClick={() => abrir(o)} className="w-full">
                  <ClipboardCheck className="mr-2 size-4" /> Apontar produção
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={alvo !== null} onOpenChange={(o) => !o && setAlvo(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{alvo ? `Apontar OP-${alvo.numero}` : "Apontar produção"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ap-boa">Peças boas</Label>
                <Input
                  id="ap-boa"
                  inputMode="decimal"
                  value={boa}
                  onChange={(e) => setBoa(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ap-ref">Refugo</Label>
                <Input
                  id="ap-ref"
                  inputMode="decimal"
                  value={refugo}
                  onChange={(e) => setRefugo(e.target.value)}
                />
              </div>
            </div>
            {(etapas?.length ?? 0) > 0 && (
              <div className="grid gap-1.5">
                <Label htmlFor="ap-etapa">Etapa (opcional)</Label>
                <Select value={etapaId} onValueChange={setEtapaId}>
                  <SelectTrigger id="ap-etapa">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_ETAPA}>Sem etapa</SelectItem>
                    {etapas!.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nome} · {formatarMinutos(e.minutos_apontados)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5 sm:max-w-[10rem]">
              <Label htmlFor="ap-min">Minutos (opcional)</Label>
              <Input
                id="ap-min"
                inputMode="numeric"
                value={minutos}
                onChange={(e) => setMinutos(e.target.value)}
              />
            </div>
            {(etapas?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Para registrar só o tempo de uma etapa, deixe peças boas e refugo em branco, escolha
                a etapa e informe os minutos.
              </p>
            )}
            {(insumos?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Insumos da ordem</p>
                <ul className="space-y-1">
                  {insumos!.map((i) => (
                    <li
                      key={i.insumo}
                      className="flex items-center justify-between gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm"
                    >
                      <span className="min-w-0 truncate">{i.insumo}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatarQuantidadeMf(Number(i.quantidade_consumida))} /{" "}
                        {formatarQuantidadeMf(Number(i.quantidade_planejada))} {i.unidade}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAlvo(null)}>
              Cancelar
            </Button>
            <Button onClick={() => apontar.mutate()} disabled={apontar.isPending}>
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
