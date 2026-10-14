import { Fragment, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { num } from "@/lib/format";
import { lerRetrato, salvarRetrato, useOnline, type Retrato } from "@/lib/offline";

export const Route = createFileRoute("/_authenticated/lotes-offline")({
  head: () => ({
    meta: [
      { title: "Lotes sem internet — ERP Ze Tech" },
      {
        name: "description",
        content: "Saldo e histórico de lotes e tonalidades para conferir mesmo sem conexão.",
      },
    ],
  }),
  component: LotesOffline,
});

type Linha = {
  id: string;
  produto: string;
  deposito: string;
  lote: string;
  tonalidade: string;
  calibre: string;
  quantidade: number;
  unidade: string;
};
type Mov = {
  lote_id: string;
  tipo: string;
  quantidade: number;
  saldo: number;
  em: string;
  doc: string;
};
type Dados = { lotes: Linha[]; movs: Mov[] };
const CHAVE = "lotes";

async function baixar(): Promise<Retrato<Dados> | null> {
  const [l, m] = await Promise.all([
    supabase
      .from("estoque_lotes")
      .select(
        "id, lote, tonalidade, calibre, quantidade, produtos(descricao, unidade), depositos(nome)",
      )
      .limit(5000),
    supabase
      .from("estoque_lote_movimentos")
      .select("lote_id, tipo, quantidade, saldo_posterior, created_at, documento, motivo")
      .order("created_at", { ascending: false })
      .limit(3000),
  ]);
  if (l.error || m.error) return null;
  type R = {
    id: string;
    lote: string;
    tonalidade: string;
    calibre: string;
    quantidade: number;
    produtos: { descricao: string; unidade: string | null } | null;
    depositos: { nome: string } | null;
  };
  const lotes = ((l.data ?? []) as unknown as R[])
    .map((r) => ({
      id: r.id,
      produto: r.produtos?.descricao ?? "—",
      deposito: r.depositos?.nome ?? "—",
      lote: r.lote,
      tonalidade: r.tonalidade,
      calibre: r.calibre,
      quantidade: Number(r.quantidade),
      unidade: r.produtos?.unidade ?? "",
    }))
    .sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR"));
  const movs = (m.data ?? []).map((x) => ({
    lote_id: x.lote_id,
    tipo: x.tipo,
    quantidade: Number(x.quantidade),
    saldo: Number(x.saldo_posterior),
    em: x.created_at,
    doc: x.documento ?? x.motivo ?? "",
  }));
  salvarRetrato<Dados>(CHAVE, { lotes, movs });
  return lerRetrato<Dados>(CHAVE);
}

function LotesOffline() {
  const online = useOnline();
  const [r, setR] = useState<Retrato<Dados> | null>(null);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function atualizar() {
    setCarregando(true);
    const n = await baixar();
    if (n) setR(n);
    setCarregando(false);
  }
  useEffect(() => setR(lerRetrato<Dados>(CHAVE)), []);
  useEffect(() => {
    if (online) void atualizar();
  }, [online]);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const l = r?.dados.lotes ?? [];
    return b
      ? l.filter((x) => `${x.produto} ${x.lote} ${x.tonalidade}`.toLowerCase().includes(b))
      : l;
  }, [r, busca]);

  return (
    <>
      <PageHeader
        title="Lotes sem internet"
        description="Saldo de cada lote e tonalidade guardado neste aparelho, com o histórico de entradas e saídas."
        actions={
          <Button
            variant="outline"
            disabled={!online || carregando}
            onClick={() => void atualizar()}
          >
            <RefreshCw className={`mr-1 size-4 ${carregando ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        }
      />
      <div
        className={`mb-4 flex items-center gap-3 rounded-lg border p-3 text-sm ${
          online ? "border-border bg-secondary" : "border-warning/40 bg-warning/10"
        }`}
      >
        {online ? <Wifi className="size-4" /> : <CloudOff className="size-4" />}
        {online ? "Com internet. " : "Sem internet. "}
        {r
          ? `Dados de ${new Date(r.em).toLocaleString("pt-BR")}.`
          : "Ainda não há cópia guardada: abra esta tela com internet uma vez."}
      </div>
      <Input
        className="mb-3 max-w-xs"
        placeholder="Buscar produto, lote ou tonalidade"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2">Depósito</th>
              <th className="px-3 py-2">Lote</th>
              <th className="px-3 py-2">Tonalidade</th>
              <th className="px-3 py-2">Calibre</th>
              <th className="px-3 py-2 text-right">Saldo</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lista.map((l) => (
              <Fragment key={l.id}>
                <tr className={l.quantidade <= 0 ? "text-destructive" : ""}>
                  <td className="px-3 py-2">{l.produto}</td>
                  <td className="px-3 py-2">{l.deposito}</td>
                  <td className="px-3 py-2 font-medium">{l.lote}</td>
                  <td className="px-3 py-2">{l.tonalidade || "—"}</td>
                  <td className="px-3 py-2">{l.calibre || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {l.quantidade <= 0 ? "Esgotado" : `${num(l.quantidade)} ${l.unidade}`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAberto(aberto === l.id ? null : l.id)}
                    >
                      Histórico
                    </Button>
                  </td>
                </tr>
                {aberto === l.id && (
                  <tr key={`${l.id}-h`}>
                    <td colSpan={7} className="bg-secondary/50 px-3 py-2 text-xs">
                      {(r?.dados.movs ?? [])
                        .filter((m) => m.lote_id === l.id)
                        .map((m, i) => (
                          <div key={i} className="flex gap-4 py-0.5">
                            <span>{new Date(m.em).toLocaleString("pt-BR")}</span>
                            <span className="capitalize">{m.tipo}</span>
                            <span>{num(m.quantidade)}</span>
                            <span>saldo {num(m.saldo)}</span>
                            <span className="text-muted-foreground">{m.doc}</span>
                          </div>
                        ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {lista.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nenhum lote.</p>}
      </div>
    </>
  );
}
