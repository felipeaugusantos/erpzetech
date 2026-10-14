import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/ajuste-lotes")({
  head: () => ({
    meta: [
      { title: "Ajuste de lotes — ERP Ze Tech" },
      { name: "description", content: "Correção do saldo de um lote com motivo obrigatório." },
    ],
  }),
  component: AjusteLotes,
});

type Lote = {
  id: string;
  lote: string;
  tonalidade: string;
  calibre: string;
  quantidade: number;
  produto_id: string;
  deposito_id: string;
  produtos: { descricao: string; unidade: string | null } | null;
  depositos: { nome: string } | null;
};

function AjusteLotes() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Lote | null>(null);
  const [saldo, setSaldo] = useState("");
  const [motivo, setMotivo] = useState("");

  const lotes = useQuery({
    queryKey: ["estoque-lotes-ajuste"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("estoque_lotes")
        .select(
          "id, lote, tonalidade, calibre, quantidade, produto_id, deposito_id, produtos(descricao, unidade), depositos(nome)",
        )
        .order("updated_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data as unknown as Lote[];
    },
  });

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const l = lotes.data ?? [];
    return b
      ? l.filter((x) =>
          [x.produtos?.descricao, x.lote, x.tonalidade, x.depositos?.nome]
            .join(" ")
            .toLowerCase()
            .includes(b),
        )
      : l;
  }, [lotes.data, busca]);

  const novo = Number(saldo.replace(",", "."));
  const valido =
    sel && saldo !== "" && Number.isFinite(novo) && novo >= 0 && motivo.trim().length >= 3;

  const ajustar = useMutation({
    networkMode: "always",
    mutationFn: async () => {
      if (!sel) return;
      const { error } = await supabase.rpc("estoque_lote_lancar", {
        p_produto_id: sel.produto_id,
        p_deposito_id: sel.deposito_id,
        p_lote: sel.lote,
        p_tonalidade: sel.tonalidade,
        p_calibre: sel.calibre,
        p_tipo: "ajuste",
        p_quantidade: novo,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saldo do lote corrigido");
      setSel(null);
      setSaldo("");
      setMotivo("");
      qc.invalidateQueries({ queryKey: ["estoque-lotes-ajuste"] });
      qc.invalidateQueries({ queryKey: ["estoque-lotes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Ajuste de lotes"
        description="Escolha o lote, informe o saldo contado e o motivo. A correção fica no histórico do lote com quem fez e quando."
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div>
          <Input
            className="mb-3 max-w-xs"
            placeholder="Buscar produto, lote, tonalidade"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <div className="panel overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2">Depósito</th>
                  <th className="px-3 py-2">Lote / tom / calibre</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lista.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => {
                      setSel(l);
                      setSaldo(String(l.quantidade));
                    }}
                    className={`cursor-pointer hover:bg-secondary/60 ${sel?.id === l.id ? "bg-secondary" : ""}`}
                  >
                    <td className="px-3 py-2">{l.produtos?.descricao}</td>
                    <td className="px-3 py-2">{l.depositos?.nome}</td>
                    <td className="px-3 py-2">
                      {l.lote} · {l.tonalidade || "—"} · {l.calibre || "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {num(Number(l.quantidade))} {l.produtos?.unidade ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!lotes.isLoading && lista.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">Nenhum lote encontrado.</p>
            )}
          </div>
        </div>
        <section className="panel h-fit space-y-3 p-4">
          {sel ? (
            <>
              <div className="text-sm">
                <p className="font-medium">{sel.produtos?.descricao}</p>
                <p className="text-xs text-muted-foreground">
                  Lote {sel.lote} · {sel.depositos?.nome} · saldo atual{" "}
                  {num(Number(sel.quantidade))}
                </p>
              </div>
              <label className="block text-xs">
                Saldo contado (novo saldo)
                <Input
                  inputMode="decimal"
                  value={saldo}
                  onChange={(e) => setSaldo(e.target.value)}
                />
              </label>
              <label className="block text-xs">
                Motivo (obrigatório)
                <Input
                  value={motivo}
                  placeholder="Ex.: contagem de inventário, peça quebrada"
                  onChange={(e) => setMotivo(e.target.value)}
                />
              </label>
              <Button
                className="w-full"
                disabled={!valido || ajustar.isPending}
                onClick={() => ajustar.mutate()}
              >
                Corrigir saldo
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Clique em um lote da lista para ajustar.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
