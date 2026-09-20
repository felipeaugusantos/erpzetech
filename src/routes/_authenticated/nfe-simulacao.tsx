import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Calculator, Landmark, Percent, Plus, Trash2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, num } from "@/lib/format";
import { PageHeader, StatCard } from "@/components/app/PageHeader";
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

export const Route = createFileRoute("/_authenticated/nfe-simulacao")({
  head: () => ({
    meta: [
      { title: "Simulação de nota fiscal — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Simule uma nota de venda ou de serviço sem valor fiscal e confira ICMS, substituição, PIS, COFINS e ISS conforme o regime da loja.",
      },
      { property: "og:title", content: "Simulação de nota fiscal — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Confira o cálculo de impostos antes de emitir a nota, sem valor fiscal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Simulacao,
});

type Linha = {
  id: string;
  descricao: string;
  quantidade: string;
  valor: string;
  cst: string;
};

const CSTS = [
  { valor: "00", label: "00 — Tributada integralmente (ICMS próprio)" },
  { valor: "20", label: "20 — Com redução de base" },
  { valor: "60", label: "60 — ICMS cobrado antes (substituição)" },
  { valor: "102", label: "102 — Simples, sem crédito de ICMS" },
  { valor: "500", label: "500 — Simples, substituição tributária" },
  { valor: "400", label: "400 — Serviço (só ISS)" },
];

const n = (v: unknown) => Number(String(v ?? "").replace(",", ".")) || 0;
const novaLinha = (): Linha => ({
  id: crypto.randomUUID(),
  descricao: "",
  quantidade: "1",
  valor: "0",
  cst: "102",
});

function Simulacao() {
  const { data: session } = useSessionData();
  const filiais = session?.filiais ?? [];
  const [filialId, setFilialId] = useState("");
  const [tipo, setTipo] = useState<"venda" | "servico">("venda");
  const [mesmoEstado, setMesmoEstado] = useState("sim");
  const [linhas, setLinhas] = useState<Linha[]>([novaLinha()]);

  const { data: configs = [] } = useQuery({
    queryKey: ["fiscal-config-filiais"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_config").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const padrao = useMemo(() => configs.find((c) => !c.filial_id) ?? null, [configs]);
  const daFilial = useMemo(
    () => configs.find((c) => c.filial_id === filialId) ?? null,
    [configs, filialId],
  );
  /** A loja tem prioridade; o que faltar vem da empresa. */
  const cfg = useMemo(() => {
    const pick = (chave: string, fallback: number) => {
      const v = (daFilial as Record<string, unknown> | null)?.[chave];
      const p = (padrao as Record<string, unknown> | null)?.[chave];
      return Number(v ?? p ?? fallback);
    };
    return {
      icmsInterna: pick("aliquota_icms_interna", 18),
      icmsInterestadual: pick("aliquota_icms_interestadual", 12),
      mva: pick("mva_st", 0),
      reducao: pick("reducao_base_icms", 0),
      pis: pick("aliquota_pis", 0),
      cofins: pick("aliquota_cofins", 0),
      iss: pick("aliquota_iss", 0),
      regime: String(
        (daFilial as Record<string, unknown> | null)?.["regime_tributario"] ??
          (padrao as Record<string, unknown> | null)?.["regime_tributario"] ??
          "simples",
      ),
    };
  }, [daFilial, padrao]);

  const aliqIcms = mesmoEstado === "sim" ? cfg.icmsInterna : cfg.icmsInterestadual;

  const calculadas = useMemo(
    () =>
      linhas.map((l) => {
        const total = n(l.quantidade) * n(l.valor);
        const cst = tipo === "servico" ? "400" : l.cst;
        const proprio = ["00", "10", "20", "70", "90", "900"].includes(cst);
        const st = ["60", "500"].includes(cst);
        const baseIcms = proprio ? total * (1 - cfg.reducao / 100) : 0;
        const valorIcms = baseIcms * (aliqIcms / 100);
        const baseSt = st ? total * (1 + cfg.mva / 100) : 0;
        const valorSt = baseSt * (aliqIcms / 100);
        const pis = total * (cfg.pis / 100);
        const cofins = total * (cfg.cofins / 100);
        // A nota real também aplica ISS sobre o total do item, então a simulação segue a mesma regra.
        const iss = total * (cfg.iss / 100);
        return { ...l, cst, total, baseIcms, valorIcms, baseSt, valorSt, pis, cofins, iss };
      }),
    [linhas, tipo, cfg, aliqIcms],
  );

  const totais = useMemo(
    () =>
      calculadas.reduce(
        (a, l) => ({
          total: a.total + l.total,
          icms: a.icms + l.valorIcms,
          st: a.st + l.valorSt,
          pis: a.pis + l.pis,
          cofins: a.cofins + l.cofins,
          iss: a.iss + l.iss,
        }),
        { total: 0, icms: 0, st: 0, pis: 0, cofins: 0, iss: 0 },
      ),
    [calculadas],
  );
  const impostos = totais.icms + totais.st + totais.pis + totais.cofins + totais.iss;

  const set = (id: string, campo: keyof Linha, valor: string) =>
    setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, [campo]: valor } : l)));

  return (
    <>
      <PageHeader
        title="Simulação de nota fiscal"
        description="Monte uma nota de teste, sem valor fiscal e sem gravar nada, só para conferir se os impostos saem conforme o regime e as alíquotas cadastradas."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/impostos-filial">
                <Percent className="size-4" /> Impostos por filial
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/prefeitura">
                <Landmark className="size-4" /> Prefeitura
              </Link>
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-[14rem]">
          <Label htmlFor="filial">Loja emitente</Label>
          <Select value={filialId} onValueChange={setFilialId}>
            <SelectTrigger id="filial">
              <SelectValue placeholder="Escolha a loja" />
            </SelectTrigger>
            <SelectContent>
              {filiais.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[12rem]">
          <Label htmlFor="tipo">Tipo de nota</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as "venda" | "servico")}>
            <SelectTrigger id="tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="venda">Nota de venda (produtos)</SelectItem>
              <SelectItem value="servico">Nota de serviço (locação)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[12rem]">
          <Label htmlFor="estado">Cliente</Label>
          <Select value={mesmoEstado} onValueChange={setMesmoEstado}>
            <SelectTrigger id="estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sim">Do mesmo estado da loja</SelectItem>
              <SelectItem value="nao">De outro estado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Badge variant="secondary">Regime: {cfg.regime.replace("_", " ")}</Badge>
        <Badge variant="outline">ICMS aplicado: {num(aliqIcms, 2)}%</Badge>
        <Badge variant="outline">
          PIS {num(cfg.pis, 2)}% · COFINS {num(cfg.cofins, 2)}% · ISS {num(cfg.iss, 2)}%
        </Badge>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Valor dos itens" value={brl(totais.total)} icon={Calculator} />
        <StatCard
          label="ICMS próprio"
          value={brl(totais.icms)}
          hint={`Substituição ${brl(totais.st)}`}
          tone="warning"
          icon={Percent}
        />
        <StatCard
          label="PIS e COFINS"
          value={brl(totais.pis + totais.cofins)}
          hint={`PIS ${brl(totais.pis)} · COFINS ${brl(totais.cofins)}`}
          icon={Percent}
        />
        <StatCard
          label="Total de impostos"
          value={brl(impostos)}
          hint={`ISS ${brl(totais.iss)} · nota ${brl(totais.total)}`}
          tone="success"
          icon={Percent}
        />
      </div>

      <div className="panel overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[12rem]">
                {tipo === "servico" ? "Equipamento / serviço" : "Produto"}
              </TableHead>
              <TableHead className="w-24">Qtd.</TableHead>
              <TableHead className="w-28">Valor unit.</TableHead>
              <TableHead className="w-56">Situação tributária</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Base ICMS</TableHead>
              <TableHead className="text-right">ICMS</TableHead>
              <TableHead className="text-right">ICMS ST</TableHead>
              <TableHead className="text-right">PIS</TableHead>
              <TableHead className="text-right">COFINS</TableHead>
              <TableHead className="text-right">ISS</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {calculadas.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <Input
                    value={l.descricao}
                    placeholder="Descrição do item"
                    onChange={(e) => set(l.id, "descricao", e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    inputMode="decimal"
                    value={l.quantidade}
                    onChange={(e) => set(l.id, "quantidade", e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    inputMode="decimal"
                    value={l.valor}
                    onChange={(e) => set(l.id, "valor", e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  {tipo === "servico" ? (
                    <span className="text-sm text-muted-foreground">Serviço — só ISS</span>
                  ) : (
                    <Select value={l.cst} onValueChange={(v) => set(l.id, "cst", v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CSTS.filter((c) => c.valor !== "400").map((c) => (
                          <SelectItem key={c.valor} value={c.valor}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell className="text-right text-numeric">{brl(l.total)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(l.baseIcms)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(l.valorIcms)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(l.valorSt)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(l.pis)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(l.cofins)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(l.iss)}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={linhas.length === 1}
                    onClick={() => setLinhas((ls) => ls.filter((x) => x.id !== l.id))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3">
          <Button variant="outline" onClick={() => setLinhas((ls) => [...ls, novaLinha()])}>
            <Plus className="size-4" /> Adicionar item
          </Button>
          <p className="text-sm">
            <span className="text-muted-foreground">Itens {brl(totais.total)} · impostos </span>
            <span className="font-semibold">{brl(impostos)}</span>
            <span className="text-muted-foreground">
              {" "}
              · total com impostos destacados{" "}
              {brl(totais.total + totais.st)}
            </span>
          </p>
        </div>
      </div>

      <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        Simulação sem valor fiscal: nada é gravado, nenhuma nota é criada e nada é enviado à Receita
        ou à prefeitura. As alíquotas vêm da loja escolhida e, no que faltar, da empresa.
      </p>
    </>
  );
}
