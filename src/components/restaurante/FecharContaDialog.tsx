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
  somaPagamentos,
  type LinhaPagamento,
} from "@/lib/restaurante-pagamentos";
import { brl } from "@/lib/format";
import { calcularConta, ehGestaoSalao } from "@/lib/restaurante";
import { CHAVE_REST, rpcRestaurante, type Comanda } from "@/lib/restaurante-dados";

/** Fecha a conta: serviço, desconto (gestão) e recebimento do saldo, depois de eventuais baixas parciais. */
export function FecharContaDialog({
  comanda,
  subtotalItens,
  jaPago,
  roles,
  onFechar,
  onFechada,
}: {
  comanda: Comanda;
  subtotalItens: number;
  jaPago: number;
  roles: string[];
  onFechar: () => void;
  onFechada: () => void;
}) {
  const qc = useQueryClient();
  const gestao = ehGestaoSalao(roles);
  const [cobrarServico, setCobrarServico] = useState(true);
  const [desconto, setDesconto] = useState("0");
  const [caixaId, setCaixaId] = useState("");
  const [linhas, setLinhas] = useState<LinhaPagamento[]>([linhaInicial()]);

  const conta = useMemo(
    () =>
      calcularConta({
        subtotal: subtotalItens,
        pessoas: comanda.pessoas,
        couvertPorPessoa: Number(comanda.couvert_por_pessoa),
        taxaServicoPercentual: Number(comanda.taxa_servico_percentual),
        cobrarServico,
        desconto: gestao ? paraNumero(desconto) : 0,
        jaPago,
      }),
    [subtotalItens, comanda, cobrarServico, desconto, gestao, jaPago],
  );

  const fechar = useMutation({
    mutationFn: async () => {
      if (conta.descontoExcede)
        throw new Error(`O desconto não pode passar do total da conta (${brl(conta.bruto)})`);
      if (conta.pagoExcede)
        throw new Error(
          `Já foram recebidos ${brl(conta.jaPago)}, mais do que o total da conta (${brl(conta.total)})`,
        );
      if (conta.restante > 0) {
        if (!caixaId) throw new Error("Escolha o caixa que vai receber a conta");
        if (somaPagamentos(linhas) !== conta.restante)
          throw new Error("Os pagamentos precisam fechar o saldo da conta");
      }
      return rpcRestaurante("restaurante_fechar_comanda", {
        p_comanda_id: comanda.id,
        p_pagamentos: conta.restante > 0 ? pagamentosParaEnvio(linhas) : [],
        p_caixa_id: conta.restante > 0 ? caixaId : null,
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
          {conta.descontoExcede && (
            <p className="text-right text-xs text-destructive">
              O desconto passa do total da conta ({brl(conta.bruto)}).
            </p>
          )}
          <div className="mt-2 flex items-center justify-between border-t pt-2 font-semibold">
            <span>Total da conta</span>
            <span>{brl(conta.total)}</span>
          </div>
          {conta.jaPago > 0 && (
            <Resumo rotulo="Já recebido em baixas parciais" valor={-conta.jaPago} />
          )}
          {conta.pagoExcede && (
            <p className="text-right text-xs text-destructive">
              O já recebido passa do total da conta. Reduza o desconto ou ative o serviço.
            </p>
          )}
          <div className="mt-1 flex items-center justify-between font-display text-lg font-bold">
            <span>{conta.jaPago > 0 ? "Falta receber" : "A receber"}</span>
            <span>{brl(conta.restante)}</span>
          </div>
        </div>

        {conta.restante > 0 && (
          <PagamentosForm
            alvo={conta.restante}
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
