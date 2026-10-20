import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Wrench } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlanosManutencao } from "@/hooks/usePlanosManutencao";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { hojeISO } from "@/lib/financeiro";
import { brl, dateBR } from "@/lib/format";
import {
  ROTULO_SITUACAO,
  erroDaManutencao,
  erroDoPlano,
  ordenarPorUrgencia,
  textoDoProgresso,
  type FormManutencao,
  type FormPlano,
  type PlanoSituacao,
} from "@/lib/manutencao-locacao";

const SEM_PLANO = "__sem_plano";

const formManutencaoVazio = (planoId = ""): FormManutencao => ({
  planoId,
  tipo: planoId ? "preventiva" : "corretiva",
  realizadaEm: hojeISO(),
  descricao: "",
  custo: "",
  responsavel: "",
});

/**
 * Plano de manutenção do equipamento: planos por dias de locação acumulados, registro da manutenção (que recomeça a contagem do plano) e
 * histórico. Plano vencido impede entregar o equipamento a um novo cliente até a manutenção ser registrada.
 */
export function ManutencaoEquipamento({
  equipamento,
  aoFechar,
}: {
  equipamento: { id: string; nome: string; situacao: string; ativo: boolean };
  aoFechar: () => void;
}) {
  const qc = useQueryClient();
  const { data: planos = [], isLoading } = usePlanosManutencao(equipamento.id);
  const [novoPlano, setNovoPlano] = useState<(FormPlano & { id?: string }) | null>(null);
  const [manutencao, setManutencao] = useState<FormManutencao | null>(null);

  const { data: historico = [] } = useQuery({
    queryKey: ["locacao-manutencoes", equipamento.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locacao_manutencoes")
        .select("id, tipo, realizada_em, descricao, custo, responsavel, plano_id")
        .eq("equipamento_id", equipamento.id)
        .order("realizada_em", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["locacao-manutencao-situacao"] });
    void qc.invalidateQueries({ queryKey: ["locacao-manutencoes", equipamento.id] });
    void qc.invalidateQueries({ queryKey: ["locacao-equipamentos"] });
  };

  const salvarPlano = useMutation({
    mutationFn: async (f: FormPlano & { id?: string; ativo?: boolean }) => {
      const { error } = await supabase.rpc("locacao_plano_salvar", {
        p_dados: {
          ...(f.id ? { id: f.id } : { equipamento_id: equipamento.id }),
          nome: f.nome.trim(),
          intervalo_dias: Number(f.intervaloDias),
          // editar um plano não mexe na data de referência (só a manutenção registrada a atualiza)
          ...(f.id ? {} : { referencia_em: f.referenciaEm }),
          ativo: f.ativo ?? true,
        } as unknown as Json,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plano salvo");
      setNovoPlano(null);
      recarregar();
    },
    onError: (e: Error) =>
      toast.error("Não foi possível salvar o plano", { description: e.message }),
  });

  const registrar = useMutation({
    mutationFn: async (f: FormManutencao) => {
      const { data, error } = await supabase.rpc("locacao_manutencao_registrar", {
        p_dados: {
          equipamento_id: equipamento.id,
          ...(f.planoId ? { plano_id: f.planoId } : {}),
          tipo: f.tipo,
          realizada_em: f.realizadaEm,
          descricao: f.descricao.trim(),
          custo: f.custo.trim() || "0",
          responsavel: f.responsavel.trim(),
        } as unknown as Json,
      });
      if (error) throw error;
      return data as unknown as { liberado: boolean };
    },
    onSuccess: (r) => {
      toast.success("Manutenção registrada", {
        description: r.liberado
          ? "O equipamento saiu de manutenção e já pode ser locado."
          : "A contagem do plano recomeçou.",
      });
      setManutencao(null);
      recarregar();
    },
    onError: (e: Error) =>
      toast.error("Não foi possível registrar a manutenção", { description: e.message }),
  });

  const planoDaManutencao = planos.find((p) => p.plano_id === manutencao?.planoId);
  const erroPlano = novoPlano ? erroDoPlano(novoPlano, hojeISO()) : null;
  const erroManut = manutencao
    ? erroDaManutencao(manutencao, hojeISO(), planoDaManutencao?.referencia_em)
    : null;

  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="size-5" /> Manutenção · {equipamento.nome}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Cada plano conta os dias em que o equipamento ficou locado desde a última manutenção. Ao
          vencer, ele não sai para um novo cliente até a manutenção ser registrada.
        </p>
        {equipamento.situacao === "manutencao" && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Este equipamento está em manutenção. Registre o reparo (tipo corretiva) para liberá-lo.
          </p>
        )}

        <div className="grid gap-2">
          {isLoading ? (
            <div className="h-16 animate-pulse rounded-md bg-muted" />
          ) : planos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum plano de manutenção ativo.</p>
          ) : (
            ordenarPorUrgencia(planos).map((p: PlanoSituacao) => (
              <div key={p.plano_id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{p.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {textoDoProgresso(p)} · última manutenção em {dateBR(p.referencia_em)}
                    </p>
                  </div>
                  <Badge
                    variant={p.situacao === "vencida" ? "destructive" : "outline"}
                    className={p.situacao === "proxima" ? "border-amber-500 text-amber-700" : ""}
                  >
                    {ROTULO_SITUACAO[p.situacao]}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setManutencao(formManutencaoVazio(p.plano_id))}>
                    Registrar manutenção
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setNovoPlano({
                        id: p.plano_id,
                        nome: p.nome,
                        intervaloDias: String(p.intervalo_dias),
                        referenciaEm: p.referencia_em,
                      })
                    }
                  >
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      salvarPlano.mutate({
                        id: p.plano_id,
                        nome: p.nome,
                        intervaloDias: String(p.intervalo_dias),
                        referenciaEm: p.referencia_em,
                        ativo: false,
                      })
                    }
                  >
                    Desativar
                  </Button>
                </div>
              </div>
            ))
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setNovoPlano({ nome: "", intervaloDias: "30", referenciaEm: hojeISO() })
              }
            >
              <Plus className="size-4" /> Novo plano
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManutencao(formManutencaoVazio())}
            >
              Registrar reparo ou manutenção avulsa
            </Button>
          </div>
        </div>

        {novoPlano && (
          <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
            <div className="sm:col-span-3 font-medium">
              {novoPlano.id ? "Editar plano" : "Novo plano de manutenção"}
            </div>
            <div className="sm:col-span-3">
              <Label htmlFor="pl-nome">Nome do plano</Label>
              <Input
                id="pl-nome"
                placeholder="Ex.: troca de óleo"
                value={novoPlano.nome}
                maxLength={80}
                onChange={(e) => setNovoPlano({ ...novoPlano, nome: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="pl-int">A cada (dias locados)</Label>
              <Input
                id="pl-int"
                inputMode="numeric"
                value={novoPlano.intervaloDias}
                onChange={(e) => setNovoPlano({ ...novoPlano, intervaloDias: e.target.value })}
              />
            </div>
            {!novoPlano.id && (
              <div>
                <Label htmlFor="pl-ref">Última manutenção em</Label>
                <Input
                  id="pl-ref"
                  type="date"
                  max={hojeISO()}
                  value={novoPlano.referenciaEm}
                  onChange={(e) => setNovoPlano({ ...novoPlano, referenciaEm: e.target.value })}
                />
              </div>
            )}
            {erroPlano && <p className="text-sm text-destructive sm:col-span-3">{erroPlano}</p>}
            <div className="flex gap-2 sm:col-span-3">
              <Button
                onClick={() => salvarPlano.mutate(novoPlano)}
                disabled={!!erroPlano || salvarPlano.isPending}
              >
                Salvar plano
              </Button>
              <Button variant="outline" onClick={() => setNovoPlano(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {manutencao && (
          <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
            <div className="sm:col-span-2 font-medium">Registrar manutenção</div>
            <div>
              <Label htmlFor="mn-plano">Plano</Label>
              <Select
                value={manutencao.planoId || SEM_PLANO}
                onValueChange={(v) =>
                  setManutencao({ ...manutencao, planoId: v === SEM_PLANO ? "" : v })
                }
              >
                <SelectTrigger id="mn-plano">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_PLANO}>Sem plano (reparo avulso)</SelectItem>
                  {planos.map((p) => (
                    <SelectItem key={p.plano_id} value={p.plano_id}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="mn-tipo">Tipo</Label>
              <Select
                value={manutencao.tipo}
                onValueChange={(v) =>
                  setManutencao({ ...manutencao, tipo: v as FormManutencao["tipo"] })
                }
              >
                <SelectTrigger id="mn-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="preventiva">Preventiva (do plano)</SelectItem>
                  <SelectItem value="corretiva">Corretiva (reparo de defeito)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="mn-desc">O que foi feito</Label>
              <Input
                id="mn-desc"
                value={manutencao.descricao}
                maxLength={500}
                onChange={(e) => setManutencao({ ...manutencao, descricao: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="mn-data">Data</Label>
              <Input
                id="mn-data"
                type="date"
                max={hojeISO()}
                value={manutencao.realizadaEm}
                onChange={(e) => setManutencao({ ...manutencao, realizadaEm: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="mn-custo">Custo (R$)</Label>
              <Input
                id="mn-custo"
                inputMode="decimal"
                value={manutencao.custo}
                onChange={(e) => setManutencao({ ...manutencao, custo: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="mn-resp">Quem fez (oficina ou pessoa)</Label>
              <Input
                id="mn-resp"
                value={manutencao.responsavel}
                onChange={(e) => setManutencao({ ...manutencao, responsavel: e.target.value })}
              />
            </div>
            {erroManut && <p className="text-sm text-destructive sm:col-span-2">{erroManut}</p>}
            <div className="flex gap-2 sm:col-span-2">
              <Button
                onClick={() => registrar.mutate(manutencao)}
                disabled={!!erroManut || registrar.isPending}
              >
                Registrar
              </Button>
              <Button variant="outline" onClick={() => setManutencao(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-2">
          <p className="text-sm font-medium">Histórico</p>
          {historico.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma manutenção registrada.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {historico.map((h) => (
                <li
                  key={h.id}
                  className="flex flex-wrap justify-between gap-2 rounded-md border p-2"
                >
                  <span>
                    {dateBR(h.realizada_em)} · {h.tipo === "corretiva" ? "Corretiva" : "Preventiva"}{" "}
                    · {h.descricao}
                    {h.responsavel ? ` (${h.responsavel})` : ""}
                  </span>
                  <span>{brl(Number(h.custo))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
