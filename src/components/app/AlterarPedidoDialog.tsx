import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Linha = { produto_id: string; descricao: string; unidade: string; quantidade: string; preco: string };
type ItemPedido = {
  produto_id: string;
  unidade: string | null;
  quantidade: number | string;
  preco_unitario: number | string;
  produtos?: unknown;
};

const n = (v: string) => {
  const x = Number(v.replace(",", "."));
  return Number.isFinite(x) ? x : 0;
};

/** Altera itens, desconto e frete de um pedido que ainda não começou a ser separado. */
export function AlterarPedidoDialog({
  open,
  onOpenChange,
  pedidoId,
  itens,
  desconto,
  frete,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pedidoId: string;
  itens: ItemPedido[];
  desconto: number;
  frete: number;
}) {
  const qc = useQueryClient();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [desc, setDesc] = useState("0");
  const [fr, setFr] = useState("0");
  const [motivo, setMotivo] = useState("");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    if (!open) return;
    setLinhas(
      itens.map((i) => ({
        produto_id: i.produto_id,
        descricao: (i.produtos as { descricao?: string } | null)?.descricao ?? "Item",
        unidade: i.unidade ?? "un",
        quantidade: String(Number(i.quantidade)),
        preco: Number(i.preco_unitario).toFixed(2),
      })),
    );
    setDesc(desconto.toFixed(2));
    setFr(frete.toFixed(2));
    setMotivo("");
    setBusca("");
  }, [open, itens, desconto, frete]);

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-busca-alterar-pedido", busca],
    enabled: open && busca.trim().length >= 2,
    queryFn: async () => {
      const t = busca.trim();
      const { data, error } = await supabase
        .from("produtos")
        .select("id, codigo_interno, descricao, unidade, preco_venda")
        .eq("ativo", true)
        .or(`descricao.ilike.%${t}%,codigo_interno.ilike.%${t}%,codigo_barras.ilike.%${t}%`)
        .limit(8);
      if (error) throw error;
      return data;
    },
  });

  const subtotal = linhas.reduce((s, l) => s + n(l.quantidade) * n(l.preco), 0);
  const total = subtotal - n(desc) + n(fr);
  const muda = (i: number, campo: "quantidade" | "preco", v: string) =>
    setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, [campo]: v } : l)));

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("pedido_alterar", {
        p_pedido_id: pedidoId,
        p_motivo: motivo.trim(),
        p_itens: linhas.map((l) => ({
          produto_id: l.produto_id,
          unidade: l.unidade,
          quantidade: n(l.quantidade),
          preco_unitario: n(l.preco),
        })) as never,
        p_desconto: n(desc),
        p_frete: n(fr),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido alterado", {
        description: "Se havia parcelas em aberto, gere as contas a receber de novo.",
      });
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["pedido", pedidoId] });
      void qc.invalidateQueries({ queryKey: ["pedidos"] });
      void qc.invalidateQueries({ queryKey: ["estoque"] });
    },
    onError: (e: Error) => toast.error("Não foi possível alterar", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Alterar pedido</DialogTitle>
          <DialogDescription>
            Mude produtos, quantidades, preços, desconto e frete. A reserva de estoque é refeita e
            as parcelas ainda não pagas são canceladas para você gerar de novo com o valor certo.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Adicionar produto: nome, código ou código de barras"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {busca.trim().length >= 2 && produtos.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
              {produtos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    setLinhas((ls) => [
                      ...ls,
                      {
                        produto_id: p.id,
                        descricao: p.descricao,
                        unidade: p.unidade ?? "un",
                        quantidade: "1",
                        preco: Number(p.preco_venda ?? 0).toFixed(2),
                      },
                    ]);
                    setBusca("");
                  }}
                >
                  {p.codigo_interno} — {p.descricao} ({brl(Number(p.preco_venda ?? 0))})
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          {linhas.map((l, i) => (
            <div key={`${l.produto_id}-${i}`} className="grid grid-cols-[1fr_6rem_7rem_auto] items-end gap-2">
              <p className="text-sm">
                {l.descricao}
                <span className="block text-xs text-muted-foreground">
                  {brl(n(l.quantidade) * n(l.preco))}
                </span>
              </p>
              <div>
                <Label className="text-xs">Qtd. ({l.unidade})</Label>
                <Input inputMode="decimal" value={l.quantidade} onChange={(e) => muda(i, "quantidade", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Preço (R$)</Label>
                <Input inputMode="decimal" value={l.preco} onChange={(e) => muda(i, "preco", e.target.value)} />
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remover ${l.descricao}`}
                onClick={() => setLinhas((ls) => ls.filter((_, k) => k !== i))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {linhas.length === 0 && (
            <p className="text-sm text-muted-foreground">Adicione ao menos um produto.</p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Desconto (R$)</Label>
            <Input inputMode="decimal" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div>
            <Label>Frete (R$)</Label>
            <Input inputMode="decimal" value={fr} onChange={(e) => setFr(e.target.value)} />
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Novo total</p>
            <p className="font-display text-xl font-bold">{brl(total)}</p>
          </div>
        </div>

        <div>
          <Label>Motivo da alteração</Label>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            disabled={!motivo.trim() || linhas.length === 0 || salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            Salvar alteração
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
