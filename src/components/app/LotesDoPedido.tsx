import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { num } from "@/lib/format";

type Item = {
  id: string;
  produto_id: string;
  quantidade: number;
  lote_id: string | null;
  produtos: { descricao: string; controla_lote: boolean; unidade: string | null } | null;
};
type Lote = {
  id: string;
  produto_id: string;
  lote: string;
  tonalidade: string;
  calibre: string;
  quantidade: number;
  depositos: { nome: string } | null;
};

/** Lote e tonalidade de cada item que controla lote — aparece no pedido e na separação. */
export function LotesDoPedido({ pedidoId, editavel }: { pedidoId: string; editavel: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["pedido-lotes", pedidoId],
    queryFn: async () => {
      const { data: itens, error } = await supabase
        .from("pedido_itens")
        .select("id, produto_id, quantidade, lote_id, produtos(descricao, controla_lote, unidade)")
        .eq("pedido_id", pedidoId);
      if (error) throw error;
      const comLote = (itens as unknown as Item[]).filter(
        (i) => i.produtos?.controla_lote || i.lote_id,
      );
      const prods = [...new Set(comLote.map((i) => i.produto_id))];
      const lotes = prods.length
        ? await supabase
            .from("estoque_lotes")
            .select("id, produto_id, lote, tonalidade, calibre, quantidade, depositos(nome)")
            .in("produto_id", prods)
        : { data: [], error: null };
      if (lotes.error) throw lotes.error;
      return { itens: comLote, lotes: (lotes.data ?? []) as unknown as Lote[] };
    },
  });

  const definir = useMutation({
    networkMode: "always",
    mutationFn: async (v: { item: string; lote: string | null }) => {
      const { error } = await supabase.rpc("pedido_item_definir_lote", {
        p_pedido_item_id: v.item,
        p_lote_id: v.lote as string,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lote do item salvo");
      qc.invalidateQueries({ queryKey: ["pedido-lotes", pedidoId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!q.data || q.data.itens.length === 0) return null;
  const rotulo = (l: Lote) =>
    `Lote ${l.lote}${l.tonalidade ? ` · Ton. ${l.tonalidade}` : ""}${l.calibre ? ` · Cal. ${l.calibre}` : ""}`;

  return (
    <section className="panel p-4">
      <p className="font-display font-semibold">Lote e tonalidade</p>
      <p className="mb-3 text-xs text-muted-foreground">
        Separe cada item do lote indicado para o cliente não receber peças de tons diferentes.
      </p>
      <div className="divide-y divide-border text-sm">
        {q.data.itens.map((i) => {
          const opcoes = q.data.lotes.filter((l) => l.produto_id === i.produto_id);
          const atual = opcoes.find((l) => l.id === i.lote_id);
          return (
            <div key={i.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-48 flex-1">
                {i.produtos?.descricao}{" "}
                <span className="text-muted-foreground">
                  ({num(Number(i.quantidade))} {i.produtos?.unidade ?? ""})
                </span>
              </span>
              {editavel ? (
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={i.lote_id ?? ""}
                  disabled={definir.isPending}
                  onChange={(e) => definir.mutate({ item: i.id, lote: e.target.value || null })}
                >
                  <option value="">Escolher lote…</option>
                  {opcoes.map((l) => (
                    <option key={l.id} value={l.id}>
                      {rotulo(l)} — {num(Number(l.quantidade))} em {l.depositos?.nome}
                    </option>
                  ))}
                </select>
              ) : null}
              <span className={atual ? "font-medium" : "text-warning"}>
                {atual ? `${rotulo(atual)} (${atual.depositos?.nome})` : "Lote não escolhido"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
