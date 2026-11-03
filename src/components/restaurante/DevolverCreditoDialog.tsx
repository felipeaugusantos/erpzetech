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
import { useCaixasAbertos } from "@/hooks/useCaixasAbertos";
import { brl } from "@/lib/format";
import { paraNumero, paraTexto } from "@/lib/restaurante-pagamentos";
import { CHAVE_REST, rpcRestaurante, type Comanda } from "@/lib/restaurante-dados";

const campo =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Devolve ao cliente a sobra do crédito (o que foi recebido acima do total da conta). Só a gestão. */
export function DevolverCreditoDialog({
  comanda,
  sobra,
  onFechar,
}: {
  comanda: Comanda;
  sobra: number;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const { data: caixas = [] } = useCaixasAbertos(comanda.filial_id);
  const [valor, setValor] = useState(paraTexto(sobra));
  const [forma, setForma] = useState("dinheiro");
  const [motivo, setMotivo] = useState("");
  const [caixaId, setCaixaId] = useState("");
  const caixa = caixaId || (caixas.length === 1 ? caixas[0]!.id : "");

  const devolver = useMutation({
    mutationFn: async () => {
      const v = paraNumero(valor);
      if (v <= 0) throw new Error("Informe o valor a devolver");
      if (v > sobra) throw new Error(`Só é possível devolver até ${brl(sobra)}`);
      if (!caixa) throw new Error("Escolha o caixa que vai devolver");
      if (motivo.trim().length < 3) throw new Error("Informe o motivo da devolução");
      return rpcRestaurante("restaurante_devolver_credito", {
        p_comanda_id: comanda.id,
        p_valor: v,
        p_caixa_id: caixa,
        p_motivo: motivo.trim(),
        p_forma: forma,
      });
    },
    onSuccess: () => {
      toast.success("Crédito devolvido");
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
      void qc.invalidateQueries({ queryKey: ["caixas"] });
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Devolver sobra do crédito</DialogTitle>
          <DialogDescription>
            O cliente recebeu {brl(sobra)} a mais do que a conta. A devolução sai do caixa e fica
            registrada.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="dev-valor">Valor (R$)</Label>
            <Input
              id="dev-valor"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="dev-forma">Como devolver</Label>
            <select
              id="dev-forma"
              className={campo}
              value={forma}
              onChange={(e) => setForma(e.target.value)}
            >
              <option value="dinheiro">Dinheiro</option>
              <option value="pix">Pix</option>
            </select>
          </div>
          <div>
            <Label htmlFor="dev-caixa">Caixa</Label>
            <select
              id="dev-caixa"
              className={campo}
              value={caixa}
              onChange={(e) => setCaixaId(e.target.value)}
            >
              <option value="">Escolha o caixa</option>
              {caixas.map((c) => (
                <option key={c.id} value={c.id}>
                  Caixa {c.numero}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="dev-motivo">Motivo</Label>
            <Input
              id="dev-motivo"
              value={motivo}
              maxLength={150}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button onClick={() => devolver.mutate()} disabled={devolver.isPending}>
            Devolver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
