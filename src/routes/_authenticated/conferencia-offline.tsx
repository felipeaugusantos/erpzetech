import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";

import { PageHeader } from "@/components/app/PageHeader";
import { useComandasOffline } from "@/components/restaurante/RestauranteOffline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { brl, num } from "@/lib/format";
import { lerRetrato, salvarRetrato, useOnline, type Retrato } from "@/lib/offline";
import { totalOffline } from "@/lib/offline-restaurante";

export const Route = createFileRoute("/_authenticated/conferencia-offline")({
  head: () => ({
    meta: [
      { title: "Conferência sem internet — ERP Ze Tech" },
      {
        name: "description",
        content: "Saldo de estoque e de caixa para conferir mesmo sem internet.",
      },
    ],
  }),
  component: Conferencia,
});

type LinhaEstoque = {
  produto: string;
  codigo: string;
  deposito: string;
  quantidade: number;
  reservado: number;
};
type LinhaCaixa = {
  id: string;
  numero: number;
  aberto_em: string;
  saldo: number;
  dinheiro: number;
};
type Dados = { estoque: LinhaEstoque[]; caixas: LinhaCaixa[] };

const CHAVE = "conferencia";
const ENTRA = ["entrada", "suprimento", "venda", "recebimento", "abertura"];
const SAI = ["saida", "sangria"];

/** Busca estoque e caixas abertos e guarda a cópia no computador. */
export async function atualizarConferencia(): Promise<Retrato<Dados> | null> {
  const [est, cx] = await Promise.all([
    supabase
      .from("estoques")
      .select("quantidade, reservado, produtos(descricao, codigo_interno), depositos(nome)")
      .limit(5000),
    supabase
      .from("caixas")
      .select("id, numero, aberto_em, valor_abertura")
      .eq("situacao", "aberto"),
  ]);
  if (est.error || cx.error) return null;
  const ids = (cx.data ?? []).map((c) => c.id);
  const movs = ids.length
    ? await supabase
        .from("caixa_movimentos")
        .select("caixa_id, tipo, valor, forma_pagamento")
        .in("caixa_id", ids)
    : { data: [], error: null };
  if (movs.error) return null;

  const caixas: LinhaCaixa[] = (cx.data ?? []).map((c) => {
    const m = (movs.data ?? []).filter((x) => x.caixa_id === c.id);
    const sinal = (t: string) => (ENTRA.includes(t) ? 1 : SAI.includes(t) ? -1 : 0);
    let saldo = m.reduce((s, x) => s + sinal(x.tipo) * Number(x.valor), 0);
    let dinheiro = m
      .filter((x) => (x.forma_pagamento ?? "dinheiro") === "dinheiro")
      .reduce((s, x) => s + sinal(x.tipo) * Number(x.valor), 0);
    if (!m.some((x) => x.tipo === "abertura")) {
      saldo += Number(c.valor_abertura);
      dinheiro += Number(c.valor_abertura);
    }
    return { id: c.id, numero: Number(c.numero), aberto_em: c.aberto_em, saldo, dinheiro };
  });

  type Row = {
    quantidade: number;
    reservado: number;
    produtos: { descricao: string; codigo_interno: string | null } | null;
    depositos: { nome: string } | null;
  };
  const estoque = ((est.data ?? []) as unknown as Row[])
    .map((r) => ({
      produto: r.produtos?.descricao ?? "—",
      codigo: r.produtos?.codigo_interno ?? "",
      deposito: r.depositos?.nome ?? "—",
      quantidade: Number(r.quantidade),
      reservado: Number(r.reservado),
    }))
    .sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR"));

  salvarRetrato<Dados>(CHAVE, { estoque, caixas });
  return lerRetrato<Dados>(CHAVE);
}

function vendasGuardadasFrente() {
  let qtd = 0;
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith("fc-fila-")) continue;
    try {
      const l = JSON.parse(localStorage.getItem(k) ?? "[]") as { total: number }[];
      qtd += l.length;
      total += l.reduce((s, p) => s + Number(p.total), 0);
    } catch {
      /* ignora */
    }
  }
  return { qtd, total };
}

function Conferencia() {
  const online = useOnline();
  const comandas = useComandasOffline();
  const [retrato, setRetrato] = useState<Retrato<Dados> | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [busca, setBusca] = useState("");
  const [frente, setFrente] = useState({ qtd: 0, total: 0 });

  useEffect(() => {
    setRetrato(lerRetrato<Dados>(CHAVE));
    setFrente(vendasGuardadasFrente());
  }, []);

  async function atualizar() {
    setAtualizando(true);
    const r = await atualizarConferencia();
    if (r) setRetrato(r);
    setFrente(vendasGuardadasFrente());
    setAtualizando(false);
  }

  useEffect(() => {
    if (online) void atualizar();
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  const pagasOffline = comandas.filter((c) => c.fechar && !c.erro);
  const totalComandas = pagasOffline.reduce(
    (s, c) => s + totalOffline(c, c.fechar!.cobrar_servico),
    0,
  );

  const estoque = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const l = retrato?.dados.estoque ?? [];
    return b
      ? l.filter((x) => x.produto.toLowerCase().includes(b) || x.codigo.toLowerCase().includes(b))
      : l;
  }, [retrato, busca]);

  return (
    <>
      <PageHeader
        title="Conferência sem internet"
        description="Saldo de estoque e de caixa guardado neste computador, para consultar mesmo sem conexão."
        actions={
          <Button
            variant="outline"
            disabled={!online || atualizando}
            onClick={() => void atualizar()}
          >
            <RefreshCw className={`mr-1 size-4 ${atualizando ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        }
      />

      <div
        className={`mb-4 flex items-center gap-3 rounded-lg border p-3 text-sm ${
          online ? "border-border bg-secondary" : "border-warning/40 bg-warning/10"
        }`}
      >
        {online ? <Wifi className="size-4" /> : <CloudOff className="size-4" />}
        <span>
          {online ? "Com internet. " : "Sem internet. "}
          {retrato
            ? `Dados de ${new Date(retrato.em).toLocaleString("pt-BR")}.`
            : "Ainda não há cópia guardada: abra esta tela com internet uma vez."}
        </span>
      </div>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(retrato?.dados.caixas ?? []).map((c) => (
          <div key={c.id} className="panel p-4">
            <p className="text-xs text-muted-foreground">Caixa {c.numero} · aberto</p>
            <p className="mt-1 font-display text-2xl font-extrabold">{brl(c.saldo)}</p>
            <p className="text-xs text-muted-foreground">
              Em dinheiro na gaveta: {brl(c.dinheiro)}
            </p>
          </div>
        ))}
        {retrato && retrato.dados.caixas.length === 0 && (
          <div className="panel p-4 text-sm text-muted-foreground">Nenhum caixa aberto.</div>
        )}
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground">Vendas do caixa a enviar</p>
          <p className="mt-1 font-display text-2xl font-extrabold">{brl(frente.total)}</p>
          <p className="text-xs text-muted-foreground">{frente.qtd} venda(s) feitas sem internet</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground">Comandas pagas a enviar</p>
          <p className="mt-1 font-display text-2xl font-extrabold">{brl(totalComandas)}</p>
          <p className="text-xs text-muted-foreground">
            {pagasOffline.length} comanda(s) do restaurante
          </p>
        </div>
      </section>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Estoque</h2>
        <Input
          className="max-w-xs"
          placeholder="Buscar produto ou código"
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
              <th className="px-3 py-2 text-right">Físico</th>
              <th className="px-3 py-2 text-right">Reservado</th>
              <th className="px-3 py-2 text-right">Disponível</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {estoque.slice(0, 500).map((l, i) => (
              <tr key={`${l.produto}-${l.deposito}-${i}`}>
                <td className="px-3 py-2">
                  {l.produto}
                  {l.codigo && (
                    <span className="ml-1 text-xs text-muted-foreground">#{l.codigo}</span>
                  )}
                </td>
                <td className="px-3 py-2">{l.deposito}</td>
                <td className="px-3 py-2 text-right">{num(l.quantidade)}</td>
                <td className="px-3 py-2 text-right">{num(l.reservado)}</td>
                <td className="px-3 py-2 text-right font-medium">
                  {num(l.quantidade - l.reservado)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {estoque.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nenhum item.</p>}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Vendas feitas sem internet só baixam o estoque depois de enviadas.
      </p>
    </>
  );
}
