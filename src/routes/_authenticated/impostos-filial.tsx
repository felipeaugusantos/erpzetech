import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Calculator, Percent, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { PageHeader } from "@/components/app/PageHeader";
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

export const Route = createFileRoute("/_authenticated/impostos-filial")({
  head: () => ({
    meta: [
      { title: "Impostos por filial — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Defina alíquotas de ICMS, substituição tributária, PIS, COFINS e ISS, série e numeração das notas de cada loja da rede.",
      },
      { property: "og:title", content: "Impostos por filial — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Configuração fiscal de cada loja no ERP Ze Tech.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImpostosFilial;
});

const CST_PIS_COFINS = [
  { valor: "01", label: "01 — Tributada com alíquota normal" },
  { valor: "04", label: "04 — Monofásica, alíquota zero" },
  { valor: "06", label: "06 — Alíquota zero" },
  { valor: "07", label: "07 — Isenta" },
  { valor: "08", label: "08 — Sem incidência" },
  { valor: "49", label: "49 — Outras saídas" },
  { valor: "99", label: "99 — Outras operações" },
];

type Form = {
  aliquota_icms_interna: string;
  aliquota_icms_interestadual: string;
  mva_st: string;
  reducao_base_icms: string;
  aliquota_pis: string;
  aliquota_cofins: string;
  aliquota_iss: string;
  cst_pis: string;
  cst_cofins: string;
  cfop_padrao: string;
  serie: string;
  proximo_numero: string;
};

const n = (v: unknown) => Number(String(v ?? "").replace(",", ".")) || 0;

function daConfig(c: Record<string, unknown> | null | undefined): Form {
  return {
    aliquota_icms_interna: String(c?.["aliquota_icms_interna"] ?? 18),
    aliquota_icms_interestadual: String(c?.["aliquota_icms_interestadual"] ?? 12),
    mva_st: String(c?.["mva_st"] ?? 0),
    reducao_base_icms: String(c?.["reducao_base_icms"] ?? 0),
    aliquota_pis: String(c?.["aliquota_pis"] ?? 0),
    aliquota_cofins: String(c?.["aliquota_cofins"] ?? 0),
    aliquota_iss: String(c?.["aliquota_iss"] ?? 0),
    cst_pis: String(c?.["cst_pis"] ?? "99"),
    cst_cofins: String(c?.["cst_cofins"] ?? "99"),
    cfop_padrao: String(c?.["cfop_padrao"] ?? "5102"),
    serie: String(c?.["serie"] ?? 1),
    proximo_numero: String(c?.["proximo_numero"] ?? 1),
  };
}

function ImpostosFilial() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const isAdmin = (session?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  const filiais = session?.filiais ?? [];
  const [filialId, setFilialId] = useState("");
  const [form, setForm] = useState<Form>(daConfig(null));

  useEffect(() => {
    if (!filialId && filiais[0]?.id) setFilialId(filiais[0].id);
  }, [filiais, filialId]);

  const { data: configs, isLoading } = useQuery({
    queryKey: ["fiscal-config-filiais"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_config").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  /** Configuração padrão da empresa, usada quando a filial não tem a própria. */
  const padrao = useMemo(
    () => (configs ?? []).find((c) => !c.filial_id) ?? null,
    [configs],
  );
  const daFilial = useMemo(
    () => (configs ?? []).find((c) => c.filial_id === filialId) ?? null,
    [configs, filialId],
  );
  const propria = Boolean(daFilial);

  useEffect(() => {
    setForm(daConfig((daFilial ?? padrao) as Record<string, unknown> | null));
  }, [daFilial, padrao, filialId]);

  const salvar = useMutation({
    mutationFn: async () => {
      const tenantId = session?.profile?.tenant_id;
      if (!tenantId) throw new Error("Perfil sem empresa vinculada");
      if (!filialId) throw new Error("Escolha a loja");
      const payload = {
        aliquota_icms_interna: n(form.aliquota_icms_interna),
        aliquota_icms_interestadual: n(form.aliquota_icms_interestadual),
        mva_st: n(form.mva_st),
        reducao_base_icms: n(form.reducao_base_icms),
        aliquota_pis: n(form.aliquota_pis),
        aliquota_cofins: n(form.aliquota_cofins),
        aliquota_iss: n(form.aliquota_iss),
        cst_pis: form.cst_pis,
        cst_cofins: form.cst_cofins,
        cfop_padrao: form.cfop_padrao,
        serie: Math.max(1, Math.trunc(n(form.serie))),
        proximo_numero: Math.max(1, Math.trunc(n(form.proximo_numero))),
      };
      if (daFilial?.id) {
        const { error } = await supabase
          .from("fiscal_config")
          .update(payload)
          .eq("id", daFilial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("fiscal_config").insert({
          ...payload,
          tenant_id: tenantId,
          empresa_id: padrao?.empresa_id ?? session?.empresa?.id ?? null,
          filial_id: filialId,
          regime_tributario: padrao?.regime_tributario ?? "simples",
          ambiente: padrao?.ambiente ?? "homologacao",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Impostos da loja salvos", {
        description: "As próximas notas dessa loja usam essas alíquotas.",
      });
      qc.invalidateQueries({ queryKey: ["fiscal-config-filiais"] });
      qc.invalidateQueries({ queryKey: ["fiscal-config"] });
      qc.invalidateQueries({ queryKey: ["fiscal-config-impostos"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const voltarAoPadrao = useMutation({
    mutationFn: async () => {
      if (!daFilial?.id) return;
      const { error } = await supabase.from("fiscal_config").delete().eq("id", daFilial.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Loja voltou a usar os impostos da empresa");
      qc.invalidateQueries({ queryKey: ["fiscal-config-filiais"] });
    },
    onError: (e: Error) =>
      toast.error("Não foi possível voltar ao padrão", { description: e.message }),
  });

  const campo = (id: keyof Form, label: string, ajuda: string, sufixo: "%" | "" = "%") => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          value={form[id]}
          disabled={!isAdmin}
          onChange={(e) => setForm((f) => ({ ...f, [id]: e.target.value }))}
          className={sufixo ? "pr-7" : ""}
        />
        {sufixo && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {sufixo}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Impostos por filial"
        description="Cada loja pode ter suas próprias alíquotas, série e numeração de nota. Sem configuração própria, a loja segue os impostos da empresa."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/impostos">
                <Percent className="size-4" /> Impostos da empresa
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/impostos-nota">
                <Calculator className="size-4" /> Impostos por nota
              </Link>
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={!isAdmin || salvar.isPending}>
              <Save className="size-4" /> Salvar impostos da loja
            </Button>
          </div>
        }
      />

      {!isAdmin && (
        <p className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Somente administrador ou gestor pode alterar os impostos das lojas.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-[16rem]">
          <Label htmlFor="filial">Loja</Label>
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
        <Badge variant={propria ? "default" : "secondary"}>
          {propria ? "Impostos próprios desta loja" : "Seguindo os impostos da empresa"}
        </Badge>
        {propria && (
          <Button
            variant="outline"
            size="sm"
            disabled={!isAdmin || voltarAoPadrao.isPending}
            onClick={() => voltarAoPadrao.mutate()}
          >
            <Trash2 className="size-4" /> Voltar ao padrão da empresa
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : filiais.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Nenhuma loja cadastrada ainda. Cadastre a loja no cadastro da empresa para configurar os
          impostos dela.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
            <div className="mb-4 flex items-center gap-2">
              <Percent className="size-4 text-primary" />
              <p className="font-display text-sm font-semibold">ICMS</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {campo(
                "aliquota_icms_interna",
                "ICMS dentro do estado",
                "Vendas para clientes do mesmo estado da loja.",
              )}
              {campo(
                "aliquota_icms_interestadual",
                "ICMS para outro estado",
                "Vendas para fora do estado da loja.",
              )}
              {campo(
                "mva_st",
                "MVA da substituição tributária",
                "Margem usada nos itens com ICMS já recolhido (CST 60 / CSOSN 500).",
              )}
              {campo(
                "reducao_base_icms",
                "Redução da base de ICMS",
                "Percentual retirado da base antes de calcular o imposto.",
              )}
            </div>

            <div className="mb-4 mt-6 flex items-center gap-2 border-t border-border pt-5">
              <Percent className="size-4 text-primary" />
              <p className="font-display text-sm font-semibold">PIS, COFINS e ISS</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {campo("aliquota_pis", "PIS", "0,65% no cumulativo e 1,65% no não cumulativo.")}
              {campo("aliquota_cofins", "COFINS", "3% no cumulativo e 7,6% no não cumulativo.")}
              {campo("aliquota_iss", "ISS (serviços)", "Só para serviços, como entrega ou montagem.")}
              <div>
                <Label htmlFor="cst_pis">Situação do PIS</Label>
                <Select
                  value={form.cst_pis}
                  onValueChange={(v) => setForm((f) => ({ ...f, cst_pis: v }))}
                  disabled={!isAdmin}
                >
                  <SelectTrigger id="cst_pis">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CST_PIS_COFINS.map((o) => (
                      <SelectItem key={o.valor} value={o.valor}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="cst_cofins">Situação do COFINS</Label>
                <Select
                  value={form.cst_cofins}
                  onValueChange={(v) => setForm((f) => ({ ...f, cst_cofins: v }))}
                  disabled={!isAdmin}
                >
                  <SelectTrigger id="cst_cofins">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CST_PIS_COFINS.map((o) => (
                      <SelectItem key={o.valor} value={o.valor}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mb-4 mt-6 flex items-center gap-2 border-t border-border pt-5">
              <Building2 className="size-4 text-primary" />
              <p className="font-display text-sm font-semibold">Nota fiscal da loja</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {campo("cfop_padrao", "CFOP padrão da venda", "Usado quando o produto não tem CFOP.", "")}
              {campo("serie", "Série da nota", "Cada loja costuma usar uma série própria.", "")}
              {campo("proximo_numero", "Próximo número", "Numeração da próxima nota desta loja.", "")}
            </div>

            <div className="mt-5">
              <Button onClick={() => salvar.mutate()} disabled={!isAdmin || salvar.isPending}>
                <Save className="size-4" /> Salvar impostos da loja
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              <p className="mb-2 font-display text-sm font-semibold text-foreground">
                Como o sistema escolhe as alíquotas
              </p>
              <ul className="list-disc space-y-1 pl-4">
                <li>Se a loja do pedido tem impostos próprios, a nota usa os dela.</li>
                <li>Sem configuração própria, a nota usa os impostos da empresa.</li>
                <li>Série e numeração também seguem a configuração da loja.</li>
                <li>
                  A alíquota do produto, quando cadastrada na tela Fiscal, tem preferência sobre a
                  alíquota geral.
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <p className="font-display text-sm font-semibold">Lojas com impostos próprios</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {(configs ?? [])
                  .filter((c) => c.filial_id)
                  .map((c) => (
                    <li key={c.id}>
                      {filiais.find((f) => f.id === c.filial_id)?.nome ?? "Loja"} — ICMS{" "}
                      {Number(c.aliquota_icms_interna ?? 0)}%
                    </li>
                  ))}
                {(configs ?? []).filter((c) => c.filial_id).length === 0 && (
                  <li>Nenhuma. Todas seguem a empresa.</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
