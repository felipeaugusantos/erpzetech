import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { brl } from "@/lib/format";
import { formasPagamento } from "@/lib/financeiro";
import { calcularConta, dividirConta, ehGestaoSalao } from "@/lib/restaurante";
import { CHAVE_REST, rpcRestaurante, type Comanda } from "@/lib/restaurante-dados";

type Linha = { forma: string; valor: string; pagante: string };

const paraNumero = (v: string) => Number(v.replace(",", ".")) || 0;
const paraTexto = (n: number) => n.toFixed(2).replace(".", ",");
const formas = formasPagamento.filter((f) => f.value !== "crediario");

/** Fecha a conta: serviço, desconto (gestão), divisão entre pagantes e recebimento no caixa. */
export function FecharContaDialog({
  comanda,
  subtotalItens,
  roles,
  onFechar,
  onFechada,
}: {
  comanda: Comanda;
  subtotalItens: number;
  roles: string[];
  onFechar: () => void;
  onFechada: () => void;
}) {
  const qc = useQueryClient();
  const gestao = ehGestaoSalao(roles);
  const [cobrarServico, setCobrarServico] = useState(true);
  const [desconto, setDesconto] = useState("0");
  const [caixaId, setCaixaId] = useState("");
  const [partes, setPartes] = useState("2");
  const [linhas, setLinhas] = useState<Linha[]>([{ forma: "dinheiro", valor: "", pagante: "" }]);

  const conta = useMemo(
    () =>
      calcularConta({
        subtotal: subtotalItens,
        pessoas: comanda.pessoas,
        couvertPorPessoa: Number(comanda.couvert_por_pessoa),
        taxaServicoPercentual: Number(comanda.taxa_servico_percentual),
        cobrarServico,
        desconto: gestao ? paraNumero(desconto) : 0,
      }),
    [subtotalItens, comanda, cobrarServico, desconto, gestao],
  );

  // com um único pagamento, o valor acompanha o total
  useEffect(() => {
    setLinhas((l) => (l.length === 1 ? [{ ...l[0]!, valor: paraTexto(conta.total) }] : l));
  }, [conta.total]);

  const { data: caixas = [] } = useQuery({
    queryKey: [CHAVE_REST, "caixas-abertos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("caixas")
        .select("id, numero, filial_id")
        .eq("situacao", "aberto")
        .order("aberto_em", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  useEffect(() => {
    if (!caixaId && caixas.length === 1) setCaixaId(caixas[0]!.id);
  }, [caixas, caixaId]);

  const pago = Math.round(linhas.reduce((s, l) => s + paraNumero(l.valor), 0) * 100) / 100;
  const diferenca = Math.round((conta.total - pago) * 100) / 100;

  const fechar = useMutation({
    mutationFn: async () => {
      if (conta.total > 0) {
        if (!caixaId) throw new Error("Escolha o caixa que vai receber a conta");
        if (diferenca !== 0) throw new Error("Os pagamentos precisam fechar o total da conta");
      }
      return rpcRestaurante("restaurante_fechar_comanda", {
        p_comanda_id: comanda.id,
        p_pagamentos:
          conta.total > 0
            ? linhas
                .filter((l) => paraNumero(l.valor) > 0)
                .map((l) => ({
                  forma: l.forma,
                  valor: paraNumero(l.valor),
                  pagante: l.pagante.trim() || null,
                }))
            : [],
        p_caixa_id: conta.total > 0 ? caixaId : null,
        p_desconto: conta.desconto,
        p_cobrar_servico: cobrarServico,
      });
    },
    onSuccess: () => {
      toast.success(`Comanda ${comanda.numero} fechada`);
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
      void qc.invalidateQueries({ queryKey: ["caixas"] });
      onFechada();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function dividir() {
    const n = Math.max(Math.floor(Number(partes)) || 1, 1);
    const valores = dividirConta(conta.total, n);
    setLinhas(valores.map((v) => ({ forma: "dinheiro", valor: paraTexto(v), pagante: "" })));
  }

  const alterar = (i: number, parcial: Partial<Linha>) =>
    setLinhas((l) => l.map((x, j) => (j === i ? { ...x, ...parcial } : x)));

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fechar a comanda {comanda.numero}</DialogTitle>
        </DialogHeader>

        <div className="rounded border p-3 text-sm">
          <Resumo rotulo="Consumo" valor={conta.subtotal} />
          {conta.couvert > 0 && <Resumo rotulo="Couvert" valor={conta.couvert} />}
          <div className="flex items-center justify-between py-0.5">
            <span className="flex items-center gap-2">
              <Switch checked={cobrarServico} onCheckedChange={setCobrarServico} id="servico" />
              <Label htmlFor="servico">Serviço ({comanda.taxa_servico_percentual}%)</Label>
            </span>
            <span>{brl(conta.servico)}</span>
          </div>
          {gestao && (
            <div className="flex items-center justify-between py-0.5">
              <Label htmlFor="desconto">Desconto (R$)</Label>
              <Input
                id="desconto"
                className="h-8 w-28 text-right"
                inputMode="decimal"
                value={desconto}
                onChange={(e) => setDesconto(e.target.value)}
              />
            </div>
          )}
          <div className="mt-2 flex items-center justify-between border-t pt-2 font-display text-lg font-bold">
            <span>Total</span>
            <span>{brl(conta.total)}</span>
          </div>
        </div>

        {conta.total > 0 && (
          <div className="grid gap-3">
            <div>
              <Label>Caixa que recebe</Label>
              <Select value={caixaId} onValueChange={setCaixaId}>
                <SelectTrigger aria-label="Caixa que recebe">
                  <SelectValue
                    placeholder={caixas.length ? "Escolha o caixa" : "Nenhum caixa aberto"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {caixas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      Caixa {c.numero}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end gap-2">
              <div className="w-24">
                <Label htmlFor="partes">Dividir por</Label>
                <Input
                  id="partes"
                  inputMode="numeric"
                  value={partes}
                  onChange={(e) => setPartes(e.target.value)}
                />
              </div>
              <Button type="button" variant="outline" onClick={dividir}>
                Dividir igualmente
              </Button>
            </div>

            {linhas.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_6.5rem_1fr_auto] items-end gap-2">
                <div>
                  <Label className="text-xs">Forma</Label>
                  <Select value={l.forma} onValueChange={(v) => alterar(i, { forma: v })}>
                    <SelectTrigger aria-label="Forma de pagamento">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {formas.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Valor</Label>
                  <Input
                    inputMode="decimal"
                    value={l.valor}
                    onChange={(e) => alterar(i, { valor: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Quem paga</Label>
                  <Input
                    value={l.pagante}
                    onChange={(e) => alterar(i, { pagante: e.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Remover pagamento"
                  disabled={linhas.length === 1}
                  onClick={() => setLinhas((x) => x.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLinhas((l) => [
                    ...l,
                    { forma: "pix", valor: diferenca > 0 ? paraTexto(diferenca) : "", pagante: "" },
                  ])
                }
              >
                <Plus className="mr-1 size-4" /> Outro pagamento
              </Button>
              <span
                className={
                  diferenca === 0 ? "text-sm text-emerald-700" : "text-sm text-destructive"
                }
              >
                {diferenca === 0
                  ? "Pagamentos conferem"
                  : diferenca > 0
                    ? `Faltam ${brl(diferenca)}`
                    : `Passou ${brl(-diferenca)}`}
              </span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button onClick={() => fechar.mutate()} disabled={fechar.isPending}>
            Receber e fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span>{rotulo}</span>
      <span>{brl(valor)}</span>
    </div>
  );
}
