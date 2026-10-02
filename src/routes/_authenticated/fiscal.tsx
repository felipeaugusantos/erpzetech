import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileText, Save, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { num } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/fiscal")({
  head: () => ({
    meta: [
      { title: "Fiscal — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Controle fiscal dos produtos: NCM, CFOP, CST/CSOSN, origem e alíquota de ICMS, com as pendências que impedem a emissão da nota.",
      },
      { property: "og:title", content: "Fiscal — ERP Ze Tech" },
      {
        property: "og:description",
        content: "NCM, CFOP e tributação dos produtos para emitir a nota fiscal no ERP Ze Tech.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Fiscal,
});

type Produto = {
  id: string;
  codigo_interno: string;
  descricao: string;
  unidade: string;
  ncm: string | null;
  cfop: string | null;
  cest: string | null;
  cst_csosn: string | null;
  origem_mercadoria: string | null;
  aliquota_icms: number;
};

const CSOSN = [
  { valor: "101", label: "101 — Tributada com crédito (Simples)" },
  { valor: "102", label: "102 — Tributada sem crédito (Simples)" },
  { valor: "103", label: "103 — Isenção de ICMS (Simples)" },
  { valor: "300", label: "300 — Imune" },
  { valor: "400", label: "400 — Não tributada (Simples)" },
  { valor: "500", label: "500 — ICMS cobrado por substituição" },
];
const CST = [
  { valor: "00", label: "00 — Tributada integralmente" },
  { valor: "20", label: "20 — Com redução de base" },
  { valor: "40", label: "40 — Isenta" },
  { valor: "41", label: "41 — Não tributada" },
  { valor: "60", label: "60 — ICMS cobrado antes (ST)" },
];
const ORIGEM = [
  { valor: "0", label: "0 — Nacional" },
  { valor: "1", label: "1 — Importado direto" },
  { valor: "2", label: "2 — Importado no mercado interno" },
  { valor: "3", label: "3 — Nacional com mais de 40% importado" },
];
const CFOPS = [
  { valor: "5102", label: "5102 — Venda no mesmo estado" },
  { valor: "6102", label: "6102 — Venda para outro estado" },
  { valor: "5405", label: "5405 — Venda com ICMS já pago (ST)" },
  { valor: "5929", label: "5929 — Venda com cupom fiscal" },
];

function Fiscal() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "pendentes">("pendentes");
  const [edicoes, setEdicoes] = useState<Record<string, Partial<Produto>>>({});

  const [padraoCfop, setPadraoCfop] = useState("5102");
  const [padraoCst, setPadraoCst] = useState("102");
  const [padraoIcms, setPadraoIcms] = useState("0");

  const { data: config } = useQuery({
    queryKey: ["fiscal-config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_config").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: produtos, isLoading } = useQuery({
    queryKey: ["fiscal-produtos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select(
          "id, codigo_interno, descricao, unidade, ncm, cfop, cest, cst_csosn, origem_mercadoria, aliquota_icms",
        )
        .eq("ativo", true)
        .is("deleted_at", null)
        .order("codigo_interno");
      if (error) throw error;
      return (data ?? []) as Produto[];
    },
  });

  const { data: notas } = useQuery({
    queryKey: ["fiscal-notas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nfe")
        .select("id, numero, situacao, ambiente, valor_total, pendencias, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const lista = useMemo(() => {
    const base = (produtos ?? []).map((p) => ({ ...p, ...(edicoes[p.id] ?? {}) }) as Produto);
    const termo = busca.trim().toLowerCase();
    return base.filter((p) => {
      const pendente =
        !p.ncm || !p.cst_csosn || !(p.cfop ?? config?.cfop_padrao) || !p.origem_mercadoria;
      if (filtro === "pendentes" && !pendente) return false;
      if (!termo) return true;
      return (
        p.descricao.toLowerCase().includes(termo) ||
        p.codigo_interno.toLowerCase().includes(termo) ||
        (p.ncm ?? "").includes(termo)
      );
    });
  }, [produtos, edicoes, busca, filtro, config]);

  const totais = useMemo(() => {
    const base = produtos ?? [];
    const semNcm = base.filter((p) => !p.ncm).length;
    const semCst = base.filter((p) => !p.cst_csosn).length;
    const semOrigem = base.filter((p) => !p.origem_mercadoria).length;
    return { total: base.length, semNcm, semCst, semOrigem };
  }, [produtos]);

  const alterar = (id: string, campo: keyof Produto, valor: string | number) =>
    setEdicoes((atual) => ({ ...atual, [id]: { ...(atual[id] ?? {}), [campo]: valor } }));

  const salvar = useMutation({
    mutationFn: async () => {
      const ids = Object.keys(edicoes);
      if (ids.length === 0) throw new Error("Nada para salvar");
      for (const id of ids) {
        const mudanca = edicoes[id]!;
        const { error } = await supabase
          .from("produtos")
          .update({
            ...(mudanca.ncm !== undefined ? { ncm: mudanca.ncm || null } : {}),
            ...(mudanca.cfop !== undefined ? { cfop: mudanca.cfop || null } : {}),
            ...(mudanca.cest !== undefined ? { cest: mudanca.cest || null } : {}),
            ...(mudanca.cst_csosn !== undefined ? { cst_csosn: mudanca.cst_csosn || null } : {}),
            ...(mudanca.origem_mercadoria !== undefined
              ? { origem_mercadoria: mudanca.origem_mercadoria || null }
              : {}),
            ...(mudanca.aliquota_icms !== undefined
              ? { aliquota_icms: Number(mudanca.aliquota_icms) || 0 }
              : {}),
          })
          .eq("id", id);
        if (error) throw error;
      }
      return ids.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} produto(s) atualizado(s)`);
      setEdicoes({});
      qc.invalidateQueries({ queryKey: ["fiscal-produtos"] });
      qc.invalidateQueries({ queryKey: ["produtos"] });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const aplicarPadrao = () => {
    const alvo = lista;
    if (alvo.length === 0) return;
    setEdicoes((atual) => {
      const novo = { ...atual };
      for (const p of alvo) {
        novo[p.id] = {
          ...(novo[p.id] ?? {}),
          ...(p.cfop ? {} : { cfop: padraoCfop }),
          ...(p.cst_csosn ? {} : { cst_csosn: padraoCst }),
          ...(p.origem_mercadoria ? {} : { origem_mercadoria: "0" }),
          ...(Number(p.aliquota_icms) > 0 ? {} : { aliquota_icms: Number(padraoIcms) || 0 }),
        };
      }
      return novo;
    });
    toast.info("Padrão aplicado nos produtos da lista — confira e salve.");
  };

  const simples = (config?.regime_tributario ?? "simples").startsWith("simples");
  const opcoesTributacao = simples ? CSOSN : CST;
  const pendentesNota = (notas ?? []).filter((n) => (n.pendencias ?? []).length > 0).length;

  return (
    <div>
      <PageHeader
        title="Fiscal"
        description="NCM, CFOP e tributação de cada produto, e o acompanhamento das notas emitidas."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/nfe">
                <FileText className="mr-2 size-4" />
                Notas fiscais
              </Link>
            </Button>
            <Button
              size="sm"
              disabled={Object.keys(edicoes).length === 0 || salvar.isPending}
              onClick={() => salvar.mutate()}
            >
              <Save className="mr-2 size-4" />
              Salvar ({Object.keys(edicoes).length})
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Produtos ativos" value={num(totais.total, 0)} icon={CheckCircle2} />
        <StatCard
          label="Sem NCM"
          value={num(totais.semNcm, 0)}
          icon={AlertTriangle}
          tone="warning"
        />
        <StatCard
          label="Sem CST/CSOSN"
          value={num(totais.semCst, 0)}
          icon={AlertTriangle}
          tone="warning"
        />
        <StatCard
          label="Notas com pendência"
          value={num(pendentesNota, 0)}
          icon={FileText}
          tone="accent"
        />
      </div>

      <div className="panel mt-6 p-4">
        <h2 className="font-display text-sm font-semibold">Padrão da loja</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Preenche de uma vez os produtos da lista que estão sem CFOP, tributação ou origem. Regime
          atual: {simples ? "Simples Nacional (CSOSN)" : "Regime normal (CST)"}.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div>
            <Label className="text-xs">CFOP padrão</Label>
            <Select value={padraoCfop} onValueChange={setPadraoCfop}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CFOPS.map((c) => (
                  <SelectItem key={c.valor} value={c.valor}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{simples ? "CSOSN" : "CST"} padrão</Label>
            <Select value={padraoCst} onValueChange={setPadraoCst}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {opcoesTributacao.map((c) => (
                  <SelectItem key={c.valor} value={c.valor}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Alíquota de ICMS (%)</Label>
            <Input
              inputMode="decimal"
              value={padraoIcms}
              onChange={(e) => setPadraoIcms(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={aplicarPadrao}>
              Aplicar na lista
            </Button>
          </div>
        </div>
      </div>

      <div className="panel mt-4 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por produto, código ou NCM"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
            <SelectTrigger className="sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pendentes">Somente com pendência fiscal</SelectItem>
              <SelectItem value="todos">Todos os produtos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="panel mt-4 overflow-x-auto">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Carregando…</p>
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhum produto nesta lista"
            description="Todos os produtos já têm NCM, CFOP, tributação e origem preenchidos."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="w-32">NCM</TableHead>
                <TableHead className="w-28">CFOP</TableHead>
                <TableHead className="w-48">{simples ? "CSOSN" : "CST"}</TableHead>
                <TableHead className="w-28">CEST</TableHead>
                <TableHead className="w-44">Origem</TableHead>
                <TableHead className="w-24 text-right">ICMS %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-medium">{p.descricao}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.codigo_interno} · {p.unidade}
                      {!p.ncm && (
                        <Badge variant="outline" className="ml-2 text-warning">
                          sem NCM
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="numeric"
                      placeholder="00000000"
                      value={p.ncm ?? ""}
                      onChange={(e) => alterar(p.id, "ncm", e.target.value.replace(/\D/g, ""))}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="numeric"
                      placeholder={config?.cfop_padrao ?? "5102"}
                      value={p.cfop ?? ""}
                      onChange={(e) => alterar(p.id, "cfop", e.target.value.replace(/\D/g, ""))}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={p.cst_csosn ?? ""}
                      onValueChange={(v) => alterar(p.id, "cst_csosn", v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Escolha" />
                      </SelectTrigger>
                      <SelectContent>
                        {opcoesTributacao.map((c) => (
                          <SelectItem key={c.valor} value={c.valor}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="numeric"
                      placeholder="opcional"
                      value={p.cest ?? ""}
                      onChange={(e) => alterar(p.id, "cest", e.target.value.replace(/\D/g, ""))}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={p.origem_mercadoria ?? ""}
                      onValueChange={(v) => alterar(p.id, "origem_mercadoria", v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Escolha" />
                      </SelectTrigger>
                      <SelectContent>
                        {ORIGEM.map((o) => (
                          <SelectItem key={o.valor} value={o.valor}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      className="text-right"
                      inputMode="decimal"
                      value={String(p.aliquota_icms ?? 0)}
                      onChange={(e) => alterar(p.id, "aliquota_icms", e.target.value)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
