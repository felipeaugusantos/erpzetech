import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { dateBR, num } from "@/lib/format";
import { ROTULO_LOTES_CLINICA, ehEmpresaSoClinica } from "@/lib/ramo-clinica";

export const Route = createFileRoute("/_authenticated/estoque-lotes")({
  head: () => ({
    meta: [
      { title: "Lotes e tonalidades — EZRA ERP" },
      {
        name: "description",
        content: "Saldo por lote, tonalidade e calibre para pisos, revestimentos e tintas.",
      },
    ],
  }),
  component: Lotes,
});

type Lote = {
  id: string;
  lote: string;
  tonalidade: string;
  calibre: string;
  quantidade: number;
  validade: string | null;
  produto_id: string;
  produtos: { descricao: string; codigo_interno: string | null; unidade: string | null } | null;
  depositos: { nome: string } | null;
};

const vazio = {
  produto_id: "",
  deposito_id: "",
  lote: "",
  tonalidade: "",
  validade: "",
  calibre: "",
  tipo: "entrada",
  quantidade: "",
  documento: "",
  motivo: "",
};

function Lotes() {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const soClinica = ehEmpresaSoClinica(
    sessao?.empresa as
      | {
          ramo_atividade?: string | null;
          cnae?: string | null;
          cnpj?: string | null;
          modulos_sem_cnpj?: string[] | null;
          modulos_liberados?: string[] | null;
        }
      | null
      | undefined,
  );
  const [f, setF] = useState(vazio);
  const [busca, setBusca] = useState("");

  const produtos = useQuery({
    queryKey: ["lotes-produtos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, descricao, codigo_interno, controla_lote")
        .eq("ativo", true)
        .order("descricao")
        .limit(3000);
      if (error) throw error;
      return data;
    },
  });
  const depositos = useQuery({
    queryKey: ["lotes-depositos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("depositos").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });
  const lotes = useQuery({
    queryKey: ["estoque-lotes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("estoque_lotes")
        .select(
          "id, lote, tonalidade, calibre, quantidade, validade, produto_id, produtos(descricao, codigo_interno, unidade), depositos(nome)",
        )
        .order("updated_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data as unknown as Lote[];
    },
  });

  const marcar = useMutation({
    networkMode: "always",
    mutationFn: async (v: { id: string; on: boolean }) => {
      const { error } = await supabase
        .from("produtos")
        .update({ controla_lote: v.on })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lotes-produtos"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const lancar = useMutation({
    networkMode: "always",
    mutationFn: async () => {
      const { error } = await supabase.rpc("estoque_lote_lancar", {
        p_produto_id: f.produto_id,
        p_deposito_id: f.deposito_id,
        p_lote: f.lote,
        p_tonalidade: f.tonalidade,
        p_calibre: f.calibre,
        p_tipo: f.tipo,
        p_quantidade: Number(f.quantidade.replace(",", ".")),
        ...(f.validade ? { p_validade: f.validade } : {}),
        ...(f.documento ? { p_documento: f.documento } : {}),
        ...(f.motivo ? { p_motivo: f.motivo } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lote atualizado");
      setF({ ...vazio, produto_id: f.produto_id, deposito_id: f.deposito_id });
      qc.invalidateQueries({ queryKey: ["estoque-lotes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const produtoSel = produtos.data?.find((p) => p.id === f.produto_id);
  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const l = lotes.data ?? [];
    return b
      ? l.filter((x) =>
          [x.produtos?.descricao, x.produtos?.codigo_interno, x.lote, x.tonalidade]
            .join(" ")
            .toLowerCase()
            .includes(b),
        )
      : l;
  }, [lotes.data, busca]);

  const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

  return (
    <>
      <PageHeader
        title={soClinica ? ROTULO_LOTES_CLINICA : "Lotes e tonalidades"}
        description={
          soClinica
            ? "Cada lote de vacina ou medicamento com o saldo guardado: a aplicação da vacina baixa do lote escolhido."
            : "Para pisos, revestimentos e tintas: o cliente leva tudo do mesmo lote e da mesma tonalidade."
        }
      />

      <section className="panel mb-6 grid gap-3 p-4 md:grid-cols-4">
        <label className="text-xs md:col-span-2">
          Produto
          <select
            className={sel}
            value={f.produto_id}
            onChange={(e) => setF({ ...f, produto_id: e.target.value })}
          >
            <option value="">Escolha…</option>
            {produtos.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.controla_lote ? "● " : ""}
                {p.descricao}
                {p.codigo_interno ? ` #${p.codigo_interno}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Depósito
          <select
            className={sel}
            value={f.deposito_id}
            onChange={(e) => setF({ ...f, deposito_id: e.target.value })}
          >
            <option value="">Escolha…</option>
            {depositos.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end text-xs">
          {produtoSel && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!produtoSel.controla_lote}
                onChange={(e) => marcar.mutate({ id: produtoSel.id, on: e.target.checked })}
              />
              Este produto controla lote
            </label>
          )}
        </div>
        <label className="text-xs">
          Lote
          <Input value={f.lote} onChange={(e) => setF({ ...f, lote: e.target.value })} />
        </label>
        <label className="text-xs">
          Tonalidade
          <Input
            value={f.tonalidade}
            placeholder="Ex.: T2"
            onChange={(e) => setF({ ...f, tonalidade: e.target.value })}
          />
        </label>
        <label className="text-xs">
          Calibre
          <Input
            value={f.calibre}
            placeholder="Ex.: C1"
            onChange={(e) => setF({ ...f, calibre: e.target.value })}
          />
        </label>
        <label className="text-xs">
          Validade{soClinica && f.tipo === "entrada" ? " (obrigatória)" : ""}
          <Input
            type="date"
            value={f.validade}
            onChange={(e) => setF({ ...f, validade: e.target.value })}
          />
        </label>
        <label className="text-xs">
          Operação
          <select
            className={sel}
            value={f.tipo}
            onChange={(e) => setF({ ...f, tipo: e.target.value })}
          >
            <option value="entrada">Entrada</option>
            <option value="saida">Saída</option>
            <option value="ajuste">Ajuste (novo saldo)</option>
          </select>
        </label>
        <label className="text-xs">
          Quantidade
          <Input
            inputMode="decimal"
            value={f.quantidade}
            onChange={(e) => setF({ ...f, quantidade: e.target.value })}
          />
        </label>
        <label className="text-xs">
          Documento (nota, pedido)
          <Input value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} />
        </label>
        <label className="text-xs">
          Motivo {f.tipo === "ajuste" && "(obrigatório)"}
          <Input value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} />
        </label>
        <div className="flex items-end">
          <Button
            className="w-full"
            disabled={
              lancar.isPending ||
              !f.produto_id ||
              !f.deposito_id ||
              !f.lote.trim() ||
              !f.quantidade ||
              // vacina e medicamento só são aplicados de lote com validade
              (soClinica && f.tipo === "entrada" && !f.validade) ||
              (f.tipo === "ajuste" && !f.motivo.trim())
            }
            onClick={() => lancar.mutate()}
          >
            Lançar
          </Button>
        </div>
      </section>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Saldo por lote</h2>
        <Input
          className="max-w-xs"
          placeholder="Buscar produto, lote ou tonalidade"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2">Depósito</th>
              <th className="px-3 py-2">Lote</th>
              <th className="px-3 py-2">Tonalidade</th>
              <th className="px-3 py-2">Calibre</th>
              <th className="px-3 py-2">Validade</th>
              <th className="px-3 py-2 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lista.map((l) => (
              <tr key={l.id} className={Number(l.quantidade) === 0 ? "text-muted-foreground" : ""}>
                <td className="px-3 py-2">{l.produtos?.descricao}</td>
                <td className="px-3 py-2">{l.depositos?.nome}</td>
                <td className="px-3 py-2 font-medium">{l.lote}</td>
                <td className="px-3 py-2">{l.tonalidade || "—"}</td>
                <td className="px-3 py-2">{l.calibre || "—"}</td>
                <td className="px-3 py-2">{l.validade ? dateBR(l.validade) : "—"}</td>
                <td className="px-3 py-2 text-right">
                  {num(Number(l.quantidade))} {l.produtos?.unidade ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lista.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">Nenhum lote lançado ainda.</p>
        )}
      </div>
    </>
  );
}
