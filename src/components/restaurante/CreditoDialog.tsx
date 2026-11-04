import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { CHAVE_REST, rpcRestaurante, type Comanda } from "@/lib/restaurante-dados";

/** Crédito na conta: dinheiro recebido adiantado (consumação, cartão pré-pago) que abate a conta no fechamento. */
export function CreditoDialog({
  comanda,
  rotulo,
  onFechar,
}: {
  comanda: Comanda;
  rotulo: string;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [valor, setValor] = useState("");
  const [caixaId, setCaixaId] = useState("");
  const [linhas, setLinhas] = useState<LinhaPagamento[]>([linhaInicial()]);
  const alvo = paraNumero(valor);

  const receber = useMutation({
    mutationFn: async () => {
      if (alvo <= 0) throw new Error("Informe o valor do crédito");
      if (!caixaId) throw new Error("Escolha o caixa que vai receber");
      if (somaPagamentos(linhas) !== alvo)
        throw new Error("Os pagamentos precisam somar o valor do crédito");
      return rpcRestaurante("restaurante_creditar_comanda", {
        p_comanda_id: comanda.id,
        p_pagamentos: pagamentosParaEnvio(linhas),
        p_caixa_id: caixaId,
      });
    },
    onSuccess: () => {
      toast.success(`Crédito de ${brl(alvo)} lançado`);
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
      void qc.invalidateQueries({ queryKey: ["caixas"] });
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar crédito — {rotulo}</DialogTitle>
          <DialogDescription>
            O valor entra no caixa agora e abate a conta quando ela for fechada. Se sobrar, a gestão
            devolve a diferença.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="credito-valor">Valor do crédito (R$)</Label>
          <Input
            id="credito-valor"
            inputMode="decimal"
            autoFocus
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </div>
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
          <Button onClick={() => receber.mutate()} disabled={alvo <= 0 || receber.isPending}>
            Receber {alvo > 0 ? brl(alvo) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
