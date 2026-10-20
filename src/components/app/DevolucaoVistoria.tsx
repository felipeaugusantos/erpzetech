import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { brl, dateBR } from "@/lib/format";
import { formasPagamento, hojeISO } from "@/lib/financeiro";
import {
  acertoDaCaucao,
  avariaVazia,
  cobrancaNaDevolucao,
  diasReaisDaLocacao,
  erroDaVistoria,
  totalDasAvarias,
  valorSugeridoPerdaTotal,
  vistoriasParaEnvio,
  type VistoriaForm,
} from "@/lib/vistoria-locacao";

type LocacaoParaDevolver = {
  id: string;
  numero: number;
  caucao: number;
  equipamento_id: string;
  inicio: string;
  entregue_em: string | null;
  dias: number;
  valor_diaria: number;
  valor_faturado: number | null;
  locacao_equipamentos: { nome: string; valor_aquisicao?: number } | null;
};

type EquipamentoDoContrato = { id: string; nome: string; valor_aquisicao: number };

/**
 * Devolução com vistoria: cada equipamento do contrato é vistoriado antes de a locação ser encerrada. O dano informado sai primeiro da
 * caução e a diferença vira conta a receber; equipamento com dano vai para manutenção e perda total tira o equipamento de uso.
 */
export function DevolucaoVistoria({
  locacao,
  caixaId,
  aoConcluir,
  aoFechar,
}: {
  locacao: LocacaoParaDevolver;
  /** Caixa aberto: pagamento à vista da locação entra nele na hora. */
  caixaId?: string;
  aoConcluir: () => void;
  aoFechar: () => void;
}) {
  const { data: itens, isLoading } = useQuery({
    queryKey: ["locacao-itens-vistoria", locacao.id],
    queryFn: async (): Promise<EquipamentoDoContrato[]> => {
      const { data, error } = await supabase
        .from("locacao_itens")
        .select("equipamento_id, locacao_equipamentos(nome, valor_aquisicao)")
        .eq("locacao_id", locacao.id);
      if (error) throw error;
      const lista = (data ?? []).map((i) => {
        const e = i.locacao_equipamentos as unknown as {
          nome: string;
          valor_aquisicao: number;
        } | null;
        return {
          id: i.equipamento_id as string,
          nome: e?.nome ?? "Equipamento",
          valor_aquisicao: Number(e?.valor_aquisicao ?? 0),
        };
      });
      // locação antiga, sem itens: o equipamento do próprio contrato
      if (lista.length === 0)
        return [
          {
            id: locacao.equipamento_id,
            nome: locacao.locacao_equipamentos?.nome ?? "Equipamento",
            valor_aquisicao: Number(locacao.locacao_equipamentos?.valor_aquisicao ?? 0),
          },
        ];
      const vistos = new Set<string>();
      return lista.filter((e) => (vistos.has(e.id) ? false : (vistos.add(e.id), true)));
    },
  });

  const [vistorias, setVistorias] = useState<VistoriaForm[]>([]);
  const [observacao, setObservacao] = useState("");
  const [data, setData] = useState(hojeISO());
  const [vencimento, setVencimento] = useState(hojeISO());
  const [enviando, setEnviando] = useState(false);
  const [forma, setForma] = useState("dinheiro");
  const [parcelas, setParcelas] = useState("1");

  useEffect(() => {
    if (itens && vistorias.length === 0)
      setVistorias(
        itens.map((e) => ({
          equipamentoId: e.id,
          nome: e.nome,
          valorAquisicao: e.valor_aquisicao,
          avarias: [],
          observacoes: "",
        })),
      );
  }, [itens, vistorias.length]);

  const dano = useMemo(() => totalDasAvarias(vistorias), [vistorias]);
  const acerto = acertoDaCaucao(Number(locacao.caucao ?? 0), dano);
  const cobranca = cobrancaNaDevolucao({
    valorDiaria: Number(locacao.valor_diaria ?? 0),
    dias: locacao.dias,
    valorFaturado: Number(locacao.valor_faturado ?? 0),
    diasReais: diasReaisDaLocacao(locacao.inicio, locacao.entregue_em, data),
  });
  const nParcelas = Number(parcelas);
  const erroCobranca =
    cobranca.gerar === "locacao" &&
    (!Number.isInteger(nParcelas) || nParcelas < 1 || nParcelas > 48)
      ? "Informe de 1 a 48 parcelas"
      : null;
  const erro = erroDaVistoria(vistorias) ?? erroCobranca;

  const mexe = (i: number, parte: Partial<VistoriaForm>) =>
    setVistorias((vs) => vs.map((v, k) => (k === i ? { ...v, ...parte } : v)));

  async function confirmar() {
    if (erro) return;
    setEnviando(true);
    try {
      const { data: r, error } = await supabase.rpc("locacao_devolver_vistoriada", {
        p_locacao_id: locacao.id,
        p_data: data,
        p_observacao: observacao,
        p_vistorias: vistoriasParaEnvio(vistorias) as unknown as Json,
        p_vencimento: vencimento,
        ...(cobranca.gerar === "locacao"
          ? {
              p_forma: forma as never,
              p_parcelas: nParcelas,
              ...(caixaId ? { p_caixa_id: caixaId } : {}),
            }
          : {}),
      });
      if (error) throw error;
      const res = r as unknown as {
        valor_avarias: number;
        a_cobrar: number;
        caucao_a_devolver: number;
      };
      toast.success("Devolução registrada", {
        description:
          res.valor_avarias > 0
            ? `Avarias de ${brl(res.valor_avarias)}: ${brl(res.a_cobrar)} a cobrar, ${brl(res.caucao_a_devolver)} de caução a devolver.`
            : `Sem avarias: devolva a caução de ${brl(res.caucao_a_devolver)} ao cliente.`,
      });
      aoConcluir();
    } catch (e) {
      toast.error("Não foi possível devolver", { description: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !enviando && aoFechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Devolução e vistoria · locação nº {locacao.numero}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Confira cada equipamento. Se houver dano, informe o que foi e quanto custa: o valor sai
          primeiro da caução e o que passar vira uma conta a receber do cliente. Depois de
          confirmada, a vistoria não se altera.
        </p>
        {isLoading ? (
          <div className="h-24 animate-pulse rounded-md bg-muted" />
        ) : (
          <div className="grid gap-4">
            {vistorias.map((v, i) => (
              <div key={v.equipamentoId} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{v.nome}</p>
                  <span className="text-xs text-muted-foreground">
                    {v.avarias.length === 0 ? "Sem avarias" : `${v.avarias.length} avaria(s)`}
                  </span>
                </div>
                <div className="mt-2 grid gap-2">
                  {v.avarias.map((a, k) => (
                    <div key={k} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto_auto]">
                      <Input
                        aria-label="Descrição da avaria"
                        placeholder="O que foi danificado"
                        value={a.descricao}
                        maxLength={200}
                        onChange={(e) =>
                          mexe(i, {
                            avarias: v.avarias.map((x, j) =>
                              j === k ? { ...x, descricao: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      <Input
                        aria-label="Valor da avaria"
                        inputMode="decimal"
                        placeholder="Valor (R$)"
                        value={a.valor}
                        onChange={(e) =>
                          mexe(i, {
                            avarias: v.avarias.map((x, j) =>
                              j === k ? { ...x, valor: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      <label className="flex items-center gap-1 text-xs">
                        <Checkbox
                          checked={a.perdaTotal}
                          onCheckedChange={(c) =>
                            mexe(i, {
                              avarias: v.avarias.map((x, j) =>
                                j === k
                                  ? {
                                      ...x,
                                      perdaTotal: c === true,
                                      // perda total sugere o valor de aquisição, que pode ser ajustado
                                      valor:
                                        c === true && x.valor.trim() === ""
                                          ? valorSugeridoPerdaTotal(v.valorAquisicao)
                                          : x.valor,
                                    }
                                  : x,
                              ),
                            })
                          }
                        />
                        Perda total
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remover avaria"
                        onClick={() => mexe(i, { avarias: v.avarias.filter((_, j) => j !== k) })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => mexe(i, { avarias: [...v.avarias, avariaVazia()] })}
                    >
                      <Plus className="size-4" /> Registrar avaria
                    </Button>
                  </div>
                  <Input
                    aria-label={`Observações da vistoria de ${v.nome}`}
                    placeholder="Observações da vistoria (opcional)"
                    value={v.observacoes}
                    onChange={(e) => mexe(i, { observacoes: e.target.value })}
                  />
                </div>
              </div>
            ))}

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="dv-data">Data da devolução</Label>
                <Input
                  id="dv-data"
                  type="date"
                  value={data}
                  max={hojeISO()}
                  onChange={(e) => setData(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="dv-venc">Vencimento das cobranças</Label>
                <Input
                  id="dv-venc"
                  type="date"
                  value={vencimento}
                  onChange={(e) => setVencimento(e.target.value)}
                />
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor="dv-obs">Observação da devolução</Label>
                <Textarea
                  id="dv-obs"
                  rows={2}
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                />
              </div>
            </div>

            {cobranca.gerar === "locacao" && (
              <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
                <div className="sm:col-span-3 text-sm">
                  <p className="font-medium">
                    Cobrança da locação: {brl(cobranca.valor)} (dias reais)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Esta locação ainda não foi cobrada: a devolução gera as contas a receber pelo
                    valor final.
                  </p>
                </div>
                <div>
                  <Label htmlFor="dv-forma">Forma de pagamento</Label>
                  <Select value={forma} onValueChange={setForma}>
                    <SelectTrigger id="dv-forma">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {formasPagamento.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="dv-parc">Parcelas</Label>
                  <Input
                    id="dv-parc"
                    inputMode="numeric"
                    value={parcelas}
                    onChange={(e) => setParcelas(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-3">
                  {caixaId
                    ? "Dinheiro, PIX e cartão de débito entram no caixa aberto na hora; as outras formas ficam em contas a receber."
                    : "Sem caixa aberto: a conta fica em aberto em contas a receber."}{" "}
                  O primeiro vencimento é a data abaixo.
                </p>
              </div>
            )}
            {cobranca.gerar === "extras" && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Devolução depois do prazo: os dias a mais ({brl(cobranca.extras)}) serão cobrados
                numa conta a receber à parte.
              </div>
            )}

            <div className="rounded-md bg-muted p-3 text-sm">
              <p>
                Avarias: <strong>{brl(dano)}</strong> · Caução recebida:{" "}
                <strong>{brl(Number(locacao.caucao ?? 0))}</strong>
              </p>
              <p>
                Abate da caução: {brl(acerto.abatida)} ·{" "}
                <strong>A cobrar do cliente: {brl(acerto.aCobrar)}</strong> · Caução a devolver:{" "}
                {brl(acerto.aDevolver)}
              </p>
              {acerto.aCobrar > 0 && (
                <p className="text-xs text-muted-foreground">
                  A cobrança vence em {dateBR(vencimento)}.
                </p>
              )}
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => void confirmar()} disabled={enviando || isLoading || !!erro}>
            {enviando ? "Registrando…" : "Confirmar devolução"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type VistoriaRegistrada = {
  id: string;
  equipamento_id: string;
  situacao: string;
  observacoes: string | null;
  valor_avarias: number;
  locacao_equipamentos: { nome: string } | null;
  locacao_vistoria_avarias: {
    id: string;
    descricao: string;
    valor: number;
    perda_total: boolean;
  }[];
};

/** Vistoria já registrada de uma locação devolvida, só para consulta. */
export function VistoriaRegistrada({
  locacaoId,
  numero,
  aoFechar,
}: {
  locacaoId: string;
  numero: number;
  aoFechar: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["locacao-vistoria", locacaoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locacao_vistorias")
        .select(
          "id, equipamento_id, situacao, observacoes, valor_avarias, locacao_equipamentos(nome), locacao_vistoria_avarias(id, descricao, valor, perda_total)",
        )
        .eq("locacao_id", locacaoId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as VistoriaRegistrada[];
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Vistoria da locação nº {numero}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-muted" />
        ) : (data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Esta locação foi devolvida antes da vistoria existir no sistema.
          </p>
        ) : (
          <div className="grid gap-3 text-sm">
            {data!.map((v) => (
              <div key={v.id} className="rounded-md border p-3">
                <p className="font-medium">{v.locacao_equipamentos?.nome ?? "Equipamento"}</p>
                {v.locacao_vistoria_avarias.length === 0 ? (
                  <p className="text-muted-foreground">Sem avarias.</p>
                ) : (
                  <ul className="mt-1 grid gap-1">
                    {v.locacao_vistoria_avarias.map((a) => (
                      <li key={a.id} className="flex justify-between gap-2">
                        <span>
                          {a.descricao}
                          {a.perda_total ? " (perda total)" : ""}
                        </span>
                        <span>{brl(Number(a.valor))}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {v.observacoes && <p className="mt-1 text-muted-foreground">{v.observacoes}</p>}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
