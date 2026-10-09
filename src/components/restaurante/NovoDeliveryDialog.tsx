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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useZonasEntrega } from "@/hooks/useZonasEntrega";
import { ROTULO_PAGAMENTO, formatarTelefone, soDigitos, telefoneValido } from "@/lib/delivery";
import { CHAVE_REST, rpcRestaurante, tabela, type Comanda } from "@/lib/restaurante-dados";

const numero = (v: string) => Number(v.replace(",", ".")) || 0;

/** Novo pedido de delivery: cliente, endereço, taxa pela zona e forma de pagamento prevista. */
export function NovoDeliveryDialog({
  onFechar,
  onCriado,
}: {
  onFechar: () => void;
  onCriado: (comandaId: string) => void;
}) {
  const qc = useQueryClient();
  const { data: zonas = [] } = useZonasEntrega();
  const [telefone, setTelefone] = useState("");
  const [cliente, setCliente] = useState("");
  const [endereco, setEndereco] = useState("");
  const [bairro, setBairro] = useState("");
  const [referencia, setReferencia] = useState("");
  const [taxa, setTaxa] = useState("0");
  const [pagamento, setPagamento] = useState("dinheiro");
  const [troco, setTroco] = useState("");
  const [observacao, setObservacao] = useState("");

  // cliente que já pediu: o telefone traz nome e endereço do último pedido (só onde o campo estiver vazio)
  async function buscarPeloTelefone() {
    const d = soDigitos(telefone);
    if (d.length < 8) return;
    const { data } = await tabela("comandas")
      .select("cliente_nome, entrega_endereco, entrega_bairro, entrega_referencia")
      .eq("tipo", "delivery")
      .eq("entrega_telefone", d)
      .order("aberta_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    const c = data as unknown as Pick<
      Comanda,
      "cliente_nome" | "entrega_endereco" | "entrega_bairro" | "entrega_referencia"
    > | null;
    if (!c) return;
    setCliente((v) => v || c.cliente_nome || "");
    setEndereco((v) => v || c.entrega_endereco || "");
    setBairro((v) => v || c.entrega_bairro || "");
    setReferencia((v) => v || c.entrega_referencia || "");
    toast.info("Dados do último pedido deste telefone preenchidos");
  }

  function escolherZona(id: string) {
    const z = zonas.find((x) => x.id === id);
    if (!z) return;
    setBairro(z.nome);
    setTaxa(String(z.taxa).replace(".", ","));
  }

  const criar = useMutation({
    mutationFn: async () => {
      if (!telefoneValido(telefone)) throw new Error("Telefone inválido");
      return rpcRestaurante<string>("restaurante_abrir_delivery", {
        p_cliente: cliente,
        p_telefone: soDigitos(telefone) || null,
        p_endereco: endereco,
        p_bairro: bairro.trim() || null,
        p_referencia: referencia.trim() || null,
        p_taxa: numero(taxa),
        p_pagamento: pagamento || null,
        p_troco_para: pagamento === "dinheiro" && troco.trim() ? numero(troco) : null,
        p_observacao: observacao.trim() || null,
      });
    },
    onSuccess: (id) => {
      toast.success("Pedido de delivery aberto");
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
      onCriado(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo pedido de delivery</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="dl-tel">Telefone</Label>
            <Input
              id="dl-tel"
              inputMode="tel"
              autoFocus
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              onBlur={() => {
                setTelefone((t) => formatarTelefone(t));
                void buscarPeloTelefone();
              }}
            />
          </div>
          <div>
            <Label htmlFor="dl-nome">Nome do cliente</Label>
            <Input id="dl-nome" value={cliente} onChange={(e) => setCliente(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="dl-end">Endereço (rua e número)</Label>
            <Input id="dl-end" value={endereco} onChange={(e) => setEndereco(e.target.value)} />
          </div>
          {zonas.some((z) => z.ativo) && (
            <div>
              <Label>Zona de entrega</Label>
              <Select onValueChange={escolherZona}>
                <SelectTrigger aria-label="Zona de entrega">
                  <SelectValue placeholder="Escolha para preencher a taxa" />
                </SelectTrigger>
                <SelectContent>
                  {zonas
                    .filter((z) => z.ativo)
                    .map((z) => (
                      <SelectItem key={z.id} value={z.id}>
                        {z.nome} · R$ {String(z.taxa).replace(".", ",")}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="dl-bairro">Bairro</Label>
            <Input id="dl-bairro" value={bairro} onChange={(e) => setBairro(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="dl-taxa">Taxa de entrega (R$)</Label>
            <Input
              id="dl-taxa"
              inputMode="decimal"
              value={taxa}
              onChange={(e) => setTaxa(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="dl-ref">Ponto de referência</Label>
            <Input id="dl-ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          </div>
          <div>
            <Label>Pagamento</Label>
            <Select value={pagamento} onValueChange={setPagamento}>
              <SelectTrigger aria-label="Forma de pagamento prevista">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROTULO_PAGAMENTO).map(([valor, rotulo]) => (
                  <SelectItem key={valor} value={valor}>
                    {rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {pagamento === "dinheiro" && (
            <div>
              <Label htmlFor="dl-troco">Troco para (R$)</Label>
              <Input
                id="dl-troco"
                inputMode="decimal"
                placeholder="se precisar"
                value={troco}
                onChange={(e) => setTroco(e.target.value)}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label htmlFor="dl-obs">Observação do pedido</Label>
            <Textarea
              id="dl-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
            Abrir e lançar os itens
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
