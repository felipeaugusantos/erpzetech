import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CHAVE_REST, rpcRestaurante, type Mesa } from "@/lib/restaurante-dados";

/** Abre a comanda de uma mesa (ou avulsa, para o balcão, quando `mesa` é nula). */
export function AbrirComandaDialog({
  aberto,
  mesa,
  onFechar,
  onAberta,
}: {
  aberto: boolean;
  mesa: Mesa | null;
  onFechar: () => void;
  onAberta: (comandaId: string) => void;
}) {
  const qc = useQueryClient();
  const [pessoas, setPessoas] = useState("");
  const [cliente, setCliente] = useState("");
  const [taxa, setTaxa] = useState("10");
  const [couvert, setCouvert] = useState("0");

  // cada abertura começa dos padrões: serviço e couvert da mesa anterior não podem vazar para a próxima
  const reiniciar = () => {
    setPessoas("");
    setCliente("");
    setTaxa("10");
    setCouvert("0");
  };
  const fechar = () => {
    reiniciar();
    onFechar();
  };

  const abrir = useMutation({
    mutationFn: async () => {
      const qtd = pessoas.trim() ? Number(pessoas) : null;
      if (qtd !== null && (!Number.isInteger(qtd) || qtd <= 0))
        throw new Error("Informe a quantidade de pessoas");
      return rpcRestaurante<string>("restaurante_abrir_comanda", {
        p_mesa_id: mesa?.id ?? null,
        p_pessoas: qtd,
        p_cliente_nome: cliente.trim() || null,
        p_taxa_servico: Number(taxa.replace(",", ".")) || 0,
        p_couvert: Number(couvert.replace(",", ".")) || 0,
      });
    },
    onSuccess: (id) => {
      toast.success(mesa ? `Mesa ${mesa.numero} aberta` : "Comanda avulsa aberta");
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
      reiniciar();
      onAberta(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mesa ? `Abrir a mesa ${mesa.numero}` : "Comanda avulsa (balcão)"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ab-pessoas">Pessoas</Label>
              <Input
                id="ab-pessoas"
                inputMode="numeric"
                value={pessoas}
                placeholder={mesa?.capacidade ? `até ${mesa.capacidade}` : ""}
                onChange={(e) => setPessoas(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ab-cliente">Nome (opcional)</Label>
              <Input id="ab-cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ab-taxa">Serviço (%)</Label>
              <Input
                id="ab-taxa"
                inputMode="decimal"
                value={taxa}
                onChange={(e) => setTaxa(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ab-couvert">Couvert por pessoa (R$)</Label>
              <Input
                id="ab-couvert"
                inputMode="decimal"
                value={couvert}
                onChange={(e) => setCouvert(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>
            Cancelar
          </Button>
          <Button onClick={() => abrir.mutate()} disabled={abrir.isPending}>
            Abrir comanda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
