import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Percent, Tag } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, num } from "@/lib/format";
import { margemSobrePreco, precoPelaMargem } from "@/lib/preco-margem";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Produto = {
  id: string;
  descricao: string;
  codigo_interno: string | null;
  unidade: string | null;
  custo: number;
  preco_venda: number;
};

const lerNum = (v: string) => Number(v.replace(",", "."));

/**
 * Grade para revisar o preço de venda dos produtos de uma compra recebida.
 * Só grava preco_venda (o custo médio é do sistema) e só quando a pessoa clica em Salvar.
 */
export function RevisarPrecosCompra({
  produtoIds,
  open,
  onOpenChange,
}: {
  produtoIds: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const ids = useMemo(() => [...new Set(produtoIds)].sort(), [produtoIds]);
  const [precos, setPrecos] = useState<Record<string, string>>({});
  const [margemAlvo, setMargemAlvo] = useState("30");

  const { data: produtos = [], isLoading } = useQuery({
    queryKey: ["revisar-precos", ids],
    enabled: open && ids.length > 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, descricao, codigo_interno, unidade, custo, preco_venda")
        .in("id", ids)
        .order("descricao");
      if (error) throw error;
      return (data ?? []).map((p) => ({
        ...p,
        custo: Number(p.custo ?? 0),
        preco_venda: Number(p.preco_venda ?? 0),
      })) as Produto[];
    },
  });

  useEffect(() => {
    if (!open) setPrecos({});
  }, [open]);

  const precoDe = (p: Produto) => precos[p.id] ?? p.preco_venda.toFixed(2);

  const alterados = produtos.filter((p) => {
    const v = lerNum(precoDe(p));
    return Number.isFinite(v) && Math.abs(v - p.preco_venda) >= 0.005;
  });

  function aplicarMargem() {
    const m = lerNum(margemAlvo);
    const novo: Record<string, string> = { ...precos };
    let n = 0;
    for (const p of produtos) {
      const preco = precoPelaMargem(p.custo, m);
      if (preco === null) continue;
      novo[p.id] = preco.toFixed(2);
      n++;
    }
    if (!n) return toast.error("Informe uma margem entre 0% e 99%, e produtos com custo.");
    setPrecos(novo);
    toast.success(`Preço sugerido em ${n} produto(s). Confira e clique em Salvar.`);
  }

  const salvar = useMutation({
    mutationFn: async () => {
      for (const p of alterados) {
        const preco = lerNum(precoDe(p));
        if (!(preco >= 0)) throw new Error(`Preço inválido em ${p.descricao}`);
        const { error } = await supabase
          .from("produtos")
          .update({ preco_venda: Math.round(preco * 100) / 100 })
          .eq("id", p.id);
        if (error) throw error;
      }
      return alterados.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} preço(s) de venda atualizado(s).`);
      void qc.invalidateQueries({ queryKey: ["revisar-precos"] });
      void qc.invalidateQueries({ queryKey: ["precos-produtos"] });
      void qc.invalidateQueries({ queryKey: ["produtos"] });
      void qc.invalidateQueries({ queryKey: ["pdv-base"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="size-5" /> Revisar preços de venda
          </DialogTitle>
          <DialogDescription>
            O custo já considera esta entrada. Ajuste o preço ou aplique uma margem; nada muda até
            você salvar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">Margem sobre o preço (%)</Label>
            <Input
              className="mt-1 w-28"
              inputMode="decimal"
              value={margemAlvo}
              onChange={(e) => setMargemAlvo(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={aplicarMargem} disabled={!produtos.length}>
            <Percent className="size-4" /> Aplicar a todos
          </Button>
        </div>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Carregando produtos…</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {produtos.map((p) => {
              const preco = lerNum(precoDe(p));
              const m = margemSobrePreco(p.custo, Number.isFinite(preco) ? preco : 0);
              const mudou = alterados.some((a) => a.id === p.id);
              return (
                <li key={p.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.codigo_interno ? `${p.codigo_interno} · ` : ""}
                      {p.unidade ?? "UN"} · atual {brl(p.preco_venda)}
                    </p>
                  </div>
                  <div className="text-sm sm:text-right">
                    <span className="text-xs text-muted-foreground">Custo </span>
                    <span className="text-numeric">{brl(p.custo)}</span>
                  </div>
                  <Input
                    aria-label={`Preço de venda de ${p.descricao}`}
                    inputMode="decimal"
                    className={`w-full sm:w-28 ${mudou ? "border-primary" : ""}`}
                    value={precoDe(p)}
                    onChange={(e) => setPrecos((a) => ({ ...a, [p.id]: e.target.value }))}
                  />
                  <span
                    className={`text-sm text-numeric sm:w-16 sm:text-right ${m < 0 ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {num(m, 1)}%
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button disabled={!alterados.length || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Salvando…" : `Salvar ${alterados.length || ""} preço(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
