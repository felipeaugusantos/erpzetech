import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
import { PagamentosForm } from "@/components/restaurante/PagamentosForm";
import {
  linhaInicial,
  pagamentosParaEnvio,
  paraNumero,
  paraTexto,
  somaPagamentos,
  type LinhaPagamento,
} from "@/lib/restaurante-pagamentos";
import { brl } from "@/lib/format";
import { calcularBaixa, calcularConta, dividirConta } from "@/lib/restaurante";
import {
  CHAVE_REST,
  rpcRestaurante,
  type Comanda,
  type ComandaItem,
} from "@/lib/restaurante-dados";

type Modo = "itens" | "valor";

/**
 * Baixa parcial: alguém da mesa vai embora e paga a sua parte, e a comanda continua aberta.
 * Por itens (unidades já entregues, com serviço e couvert) ou por um valor livre.
 */
export function BaixaParcialDialog({
  comanda,
  itens,
  subtotalItens,
  jaPago,
  onFechar,
  onConcluida,
}: {
  comanda: Comanda;
  itens: ComandaItem[];
  subtotalItens: number;
  jaPago: number;
  onFechar: () => void;
  onConcluida: () => void;
}) {
  const qc = useQueryClient();
  const [modo, setModo] = useState<Modo>("itens");
  const [escolhidos, setEscolhidos] = useState<Record<string, string>>({});
  const [pessoas, setPessoas] = useState("0");
  const [cobrarServico, setCobrarServico] = useState(true);
  const [pagante, setPagante] = useState("");
  const [valorLivre, setValorLivre] = useState("");
  const [partesSaldo, setPartesSaldo] = useState("2");
  const [caixaId, setCaixaId] = useState("");
  const [linhas, setLinhas] = useState<LinhaPagamento[]>([linhaInicial()]);

  // só item já entregue e ainda não pago pode ser baixado
  const pagaveis = useMemo(
    () => itens.filter((i) => i.situacao === "entregue" && !i.pago_em),
    [itens],
  );
  const pessoasLivres = Math.max((comanda.pessoas ?? 0) - (comanda.pessoas_pagas ?? 0), 0);

  const conta = calcularConta({
    subtotal: subtotalItens,
    pessoas: comanda.pessoas,
    couvertPorPessoa: Number(comanda.couvert_por_pessoa),
    taxaServicoPercentual: Number(comanda.taxa_servico_percentual),
    cobrarServico: true,
    desconto: 0,
    jaPago,
  });

  const selecionados = pagaveis
    .filter((i) => i.id in escolhidos)
    .map((i) => {
      const texto = (escolhidos[i.id] ?? "").trim();
      const q = texto === "" ? Number(i.quantidade) : paraNumero(texto);
      return { item: i, quantidade: Math.min(Math.max(q, 0), Number(i.quantidade)) };
    });
  const nPessoas = Math.min(Math.max(Math.floor(Number(pessoas)) || 0, 0), pessoasLivres);

  const baixa = calcularBaixa({
    linhas: selecionados.map((s) => ({
      preco: Number(s.item.preco_unitario),
      quantidade: s.quantidade,
    })),
    pessoas: nPessoas,
    couvertPorPessoa: Number(comanda.couvert_por_pessoa),
    taxaServicoPercentual: Number(comanda.taxa_servico_percentual),
    cobrarServico,
  });

  const alvo = modo === "itens" ? baixa.total : paraNumero(valorLivre);

  function alternar(i: ComandaItem) {
    setEscolhidos((atual) => {
      const { [i.id]: removido, ...resto } = atual;
      return removido !== undefined ? resto : { ...atual, [i.id]: String(Number(i.quantidade)) };
    });
  }

  const receber = useMutation({
    mutationFn: async () => {
      if (modo === "itens" && selecionados.length === 0 && nPessoas === 0)
        throw new Error("Escolha os itens ou as pessoas que estão saindo");
      if (selecionados.some((s) => s.quantidade <= 0))
        throw new Error("Informe a quantidade de cada item que será pago");
      if (alvo <= 0) throw new Error("Informe o valor a receber");
      if (modo === "valor" && alvo > conta.restante)
        throw new Error(`O valor passa do saldo da conta (${brl(conta.restante)})`);
      if (!caixaId) throw new Error("Escolha o caixa que vai receber");
      if (somaPagamentos(linhas) !== alvo)
        throw new Error("Os pagamentos precisam somar o valor da baixa");
      return rpcRestaurante("restaurante_receber_parcial", {
        p_comanda_id: comanda.id,
        p_pagamentos: pagamentosParaEnvio(linhas),
        p_caixa_id: caixaId,
        p_itens:
          modo === "itens"
            ? selecionados.map((s) => ({ id: s.item.id, quantidade: s.quantidade }))
            : [],
        p_pessoas: modo === "itens" ? nPessoas : 0,
        p_cobrar_servico: modo === "itens" ? cobrarServico : true,
        p_pagante: pagante.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success(`Baixa parcial de ${brl(alvo)} recebida`);
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
      void qc.invalidateQueries({ queryKey: ["caixas"] });
      onConcluida();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receber uma parte da conta</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Saldo da conta: <strong>{brl(conta.restante)}</strong>
          {conta.jaPago > 0 && <> · já recebido {brl(conta.jaPago)}</>}. A comanda continua aberta.
        </p>

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={modo === "itens" ? "default" : "outline"}
            onClick={() => setModo("itens")}
          >
            Por itens
          </Button>
          <Button
            type="button"
            size="sm"
            variant={modo === "valor" ? "default" : "outline"}
            onClick={() => setModo("valor")}
          >
            Por valor
          </Button>
        </div>

        <div>
          <Label htmlFor="bp-pagante">Quem está pagando (opcional)</Label>
          <Input id="bp-pagante" value={pagante} onChange={(e) => setPagante(e.target.value)} />
        </div>

        {modo === "itens" ? (
          <div className="space-y-3">
            {pagaveis.length === 0 && (
              <p className="rounded border p-3 text-sm text-muted-foreground">
                Não há itens entregues e ainda sem pagamento. Use &quot;Por valor&quot; ou entregue
                os itens que faltam.
              </p>
            )}
            <ul className="space-y-1">
              {pagaveis.map((i) => {
                const marcado = i.id in escolhidos;
                return (
                  <li key={i.id} className="flex items-center gap-2 rounded border p-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`Pagar ${i.nome}`}
                      checked={marcado}
                      onChange={() => alternar(i)}
                    />
                    <span className="flex-1">
                      {i.nome}
                      <span className="block text-xs text-muted-foreground">
                        {Number(i.quantidade)} na conta · {brl(i.preco_unitario)} cada
                      </span>
                    </span>
                    {marcado && Number(i.quantidade) > 1 && (
                      <Input
                        aria-label={`Quantidade de ${i.nome} a pagar`}
                        className="h-8 w-16 text-right"
                        inputMode="decimal"
                        value={escolhidos[i.id] ?? ""}
                        onChange={(e) => setEscolhidos({ ...escolhidos, [i.id]: e.target.value })}
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-end gap-3">
              {pessoasLivres > 0 && Number(comanda.couvert_por_pessoa) > 0 && (
                <div className="w-44">
                  <Label htmlFor="bp-pessoas">Pessoas que saem (couvert)</Label>
                  <Input
                    id="bp-pessoas"
                    inputMode="numeric"
                    value={pessoas}
                    onChange={(e) => setPessoas(e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">
                    até {pessoasLivres} sem couvert pago
                  </span>
                </div>
              )}
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Switch checked={cobrarServico} onCheckedChange={setCobrarServico} />
                Serviço ({comanda.taxa_servico_percentual}%)
              </label>
            </div>

            <div className="rounded border p-3 text-sm">
              <Linha rotulo="Itens" valor={baixa.itens} />
              {baixa.couvert > 0 && <Linha rotulo="Couvert" valor={baixa.couvert} />}
              {baixa.servico > 0 && <Linha rotulo="Serviço" valor={baixa.servico} />}
              <div className="mt-1 flex justify-between border-t pt-1 font-display text-lg font-bold">
                <span>Esta pessoa paga</span>
                <span>{brl(baixa.total)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-36">
                <Label htmlFor="bp-valor">Valor a receber (R$)</Label>
                <Input
                  id="bp-valor"
                  inputMode="decimal"
                  value={valorLivre}
                  onChange={(e) => setValorLivre(e.target.value)}
                />
              </div>
              <div className="w-24">
                <Label htmlFor="bp-partes">Saldo ÷</Label>
                <Input
                  id="bp-partes"
                  inputMode="numeric"
                  value={partesSaldo}
                  onChange={(e) => setPartesSaldo(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const n = Math.max(Math.floor(Number(partesSaldo)) || 1, 1);
                  setValorLivre(paraTexto(dividirConta(conta.restante, n)[0] ?? 0));
                }}
              >
                Parte de cada um
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              O saldo inclui o serviço e o couvert. Divida o que sobra entre quem fica.
            </p>
          </div>
        )}

        {alvo > 0 && (
          <PagamentosForm
            alvo={alvo}
            linhas={linhas}
            onLinhas={setLinhas}
            caixaId={caixaId}
            onCaixa={setCaixaId}
            filialId={comanda.filial_id}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button onClick={() => receber.mutate()} disabled={receber.isPending}>
            Receber {alvo > 0 ? brl(alvo) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex justify-between py-0.5">
      <span>{rotulo}</span>
      <span>{brl(valor)}</span>
    </div>
  );
}
