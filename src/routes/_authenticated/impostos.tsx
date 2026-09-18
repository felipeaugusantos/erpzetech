import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, FileText, Percent, Save } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { PageHeader } from "@/components/app/PageHeader";
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

export const Route = createFileRoute("/_authenticated/impostos")({
  head: () => ({
    meta: [
      { title: "Impostos da empresa — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Defina as alíquotas de ICMS dentro e fora do estado, substituição tributária, PIS, COFINS e ISS usadas no cálculo das notas fiscais.",
      },
      { property: "og:title", content: "Impostos da empresa — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Alíquotas de ICMS, PIS, COFINS e ISS da empresa no ERP Ze Tech.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Impostos,
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

const REGIMES: Record<string, string> = {
  simples: "Simples Nacional",
  simples_excesso: "Simples Nacional com excesso de sublimite",
  presumido: "Lucro Presumido",
  real: "Lucro Real",
  mei: "MEI",
};

const vazio = {
  aliquota_icms_interna: "18",
  aliquota_icms_interestadual: "12",
  mva_st: "0",
  reducao_base_icms: "0",
  aliquota_pis: "0",
  aliquota_cofins: "0",
  aliquota_iss: "0",
  cst_pis: "99",
  cst_cofins: "99",
  cfop_padrao: "5102",
};

function Impostos() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const isAdmin = session?.roles.includes("administrador") ?? false;
  const [form, setForm] = useState(vazio);

  const { data: config, isLoading } = useQuery({
    queryKey: ["fiscal-config-impostos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_config").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!config) return;
    setForm({
      aliquota_icms_interna: String(config.aliquota_icms_interna ?? 18),
      aliquota_icms_interestadual: String(config.aliquota_icms_interestadual ?? 12),
      mva_st: String(config.mva_st ?? 0),
      reducao_base_icms: String(config.reducao_base_icms ?? 0),
      aliquota_pis: String(config.aliquota_pis ?? 0),
      aliquota_cofins: String(config.aliquota_cofins ?? 0),
      aliquota_iss: String(config.aliquota_iss ?? 0),
      cst_pis: config.cst_pis ?? "99",
      cst_cofins: config.cst_cofins ?? "99",
      cfop_padrao: config.cfop_padrao ?? "5102",
    });
  }, [config]);

  const salvar = useMutation({
    mutationFn: async () => {
      const tenantId = session?.profile?.tenant_id;
      if (!tenantId) throw new Error("Perfil sem empresa vinculada");
      const n = (v: string) => Number(String(v).replace(",", ".")) || 0;
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
      };
      if (config?.id) {
        const { error } = await supabase.from("fiscal_config").update(payload).eq("id", config.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("fiscal_config").insert({
          ...payload,
          tenant_id: tenantId,
          empresa_id: session?.empresa?.id ?? null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Alíquotas salvas", {
        description: "As novas notas já saem com esses impostos.",
      });
      qc.invalidateQueries({ queryKey: ["fiscal-config-impostos"] });
      qc.invalidateQueries({ queryKey: ["fiscal-config"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const campo = (
    id: keyof typeof vazio,
    label: string,
    ajuda: string,
    sufixo: "%" | "" = "%",
  ) => (
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
        title="Impostos da empresa"
        description="Alíquotas padrão de ICMS, substituição tributária, PIS, COFINS e ISS usadas no cálculo das notas fiscais."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/impostos-nota">
                <Calculator className="size-4" /> Impostos por nota
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/fiscal">
                <FileText className="size-4" /> NCM e CFOP dos produtos
              </Link>
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={!isAdmin || salvar.isPending}>
              <Save className="size-4" /> Salvar alíquotas
            </Button>
          </div>
        }
      />

      {!isAdmin && (
        <p className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Somente o administrador da empresa pode alterar as alíquotas.
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
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
                "Vendas para clientes do mesmo estado (normalmente 18%).",
              )}
              {campo(
                "aliquota_icms_interestadual",
                "ICMS para outro estado",
                "Vendas para fora do estado (normalmente 12% ou 7%).",
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
              {campo("aliquota_pis", "PIS", "0,65% no regime cumulativo e 1,65% no não cumulativo.")}
              {campo(
                "aliquota_cofins",
                "COFINS",
                "3% no regime cumulativo e 7,6% no não cumulativo.",
              )}
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
              <div>
                <Label htmlFor="cfop_padrao">CFOP padrão da venda</Label>
                <Input
                  id="cfop_padrao"
                  value={form.cfop_padrao}
                  maxLength={4}
                  disabled={!isAdmin}
                  onChange={(e) => setForm((f) => ({ ...f, cfop_padrao: e.target.value }))}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Usado quando o produto não tem CFOP próprio.
                </p>
              </div>
            </div>

            <div className="mt-5">
              <Button onClick={() => salvar.mutate()} disabled={!isAdmin || salvar.isPending}>
                <Save className="size-4" /> Salvar alíquotas
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="font-display text-sm font-semibold">Regime da empresa</p>
              <p className="mt-2 text-sm">
                {REGIMES[config?.regime_tributario ?? "simples"] ?? "Simples Nacional"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                O regime vem do cadastro da empresa e define se a nota sai com CSOSN (Simples) ou
                CST.
              </p>
              <Button variant="outline" size="sm" className="mt-3" asChild>
                <Link to="/empresa">Alterar no cadastro da empresa</Link>
              </Button>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              <p className="mb-2 font-display text-sm font-semibold text-foreground">
                Como o cálculo acontece
              </p>
              <ul className="list-disc space-y-1 pl-4">
                <li>
                  Itens tributados (CST 00/20 ou CSOSN 900) recebem ICMS sobre o valor do item,
                  menos a redução de base.
                </li>
                <li>
                  Itens com ICMS já recolhido (CST 60 ou CSOSN 500), como cimento e tintas, recebem
                  a substituição tributária com a MVA.
                </li>
                <li>Itens isentos ou sem crédito (CSOSN 101/102/400) saem sem ICMS.</li>
                <li>PIS, COFINS e ISS incidem sobre o valor de cada item.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
