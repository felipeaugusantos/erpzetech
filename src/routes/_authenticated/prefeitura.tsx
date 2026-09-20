import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Calculator, Landmark, Percent, Save } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { useModulosCnae } from "@/lib/cnae";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/prefeitura")({
  head: () => ({
    meta: [
      { title: "Configuração de prefeitura — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Defina prefeitura, regime e alíquotas de ICMS, PIS, COFINS e ISS de cada loja para a emissão da nota de serviço.",
      },
      { property: "og:title", content: "Configuração de prefeitura — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Prefeitura, regime tributário e alíquotas de serviço de cada loja da rede.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Prefeitura,
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

const REGIMES = [
  { valor: "simples", label: "Simples Nacional" },
  { valor: "simples_excesso", label: "Simples com excesso de receita" },
  { valor: "presumido", label: "Lucro Presumido" },
  { valor: "real", label: "Lucro Real" },
  { valor: "mei", label: "MEI" },
];

const PADROES_NFSE = [
  "abrasf",
  "ginfes",
  "betha",
  "dsfnet",
  "issnet",
  "webiss",
  "prefeitura_sp",
  "outro",
];

type Form = {
  regime_tributario: string;
  nfse_prefeitura: string;
  nfse_codigo_municipio: string;
  nfse_padrao: string;
  codigo_servico: string;
  item_lista_servico: string;
  nfse_codigo_tributacao: string;
  nfse_regime_especial: string;
  aliquota_iss: string;
  nfse_iss_retido: boolean;
  nfse_optante_simples: boolean;
  aliquota_icms_interna: string;
  aliquota_icms_interestadual: string;
  aliquota_pis: string;
  aliquota_cofins: string;
  cst_pis: string;
  cst_cofins: string;
  serie_nfse: string;
  proximo_numero_nfse: string;
};

const n = (v: unknown) => Number(String(v ?? "").replace(",", ".")) || 0;

function daConfig(c: Record<string, unknown> | null | undefined): Form {
  return {
    regime_tributario: String(c?.["regime_tributario"] ?? "simples"),
    nfse_prefeitura: String(c?.["nfse_prefeitura"] ?? ""),
    nfse_codigo_municipio: String(c?.["nfse_codigo_municipio"] ?? ""),
    nfse_padrao: String(c?.["nfse_padrao"] ?? "abrasf"),
    codigo_servico: String(c?.["codigo_servico"] ?? ""),
    item_lista_servico: String(c?.["item_lista_servico"] ?? "3.05"),
    nfse_codigo_tributacao: String(c?.["nfse_codigo_tributacao"] ?? ""),
    nfse_regime_especial: String(c?.["nfse_regime_especial"] ?? ""),
    aliquota_iss: String(c?.["aliquota_iss"] ?? 0),
    nfse_iss_retido: Boolean(c?.["nfse_iss_retido"] ?? false),
    nfse_optante_simples: Boolean(c?.["nfse_optante_simples"] ?? true),
    aliquota_icms_interna: String(c?.["aliquota_icms_interna"] ?? 18),
    aliquota_icms_interestadual: String(c?.["aliquota_icms_interestadual"] ?? 12),
    aliquota_pis: String(c?.["aliquota_pis"] ?? 0),
    aliquota_cofins: String(c?.["aliquota_cofins"] ?? 0),
    cst_pis: String(c?.["cst_pis"] ?? "99"),
    cst_cofins: String(c?.["cst_cofins"] ?? "99"),
    serie_nfse: String(c?.["serie_nfse"] ?? 1),
    proximo_numero_nfse: String(c?.["proximo_numero_nfse"] ?? 1),
  };
}

function Prefeitura() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const modulos = useModulosCnae();
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

  const padrao = useMemo(() => (configs ?? []).find((c) => !c.filial_id) ?? null, [configs]);
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
        regime_tributario: form.regime_tributario,
        nfse_prefeitura: form.nfse_prefeitura || null,
        nfse_codigo_municipio: form.nfse_codigo_municipio || null,
        nfse_padrao: form.nfse_padrao || null,
        codigo_servico: form.codigo_servico || null,
        item_lista_servico: form.item_lista_servico || null,
        nfse_codigo_tributacao: form.nfse_codigo_tributacao || null,
        nfse_regime_especial: form.nfse_regime_especial || null,
        aliquota_iss: n(form.aliquota_iss),
        nfse_iss_retido: form.nfse_iss_retido,
        nfse_optante_simples: form.nfse_optante_simples,
        aliquota_icms_interna: n(form.aliquota_icms_interna),
        aliquota_icms_interestadual: n(form.aliquota_icms_interestadual),
        aliquota_pis: n(form.aliquota_pis),
        aliquota_cofins: n(form.aliquota_cofins),
        cst_pis: form.cst_pis,
        cst_cofins: form.cst_cofins,
        serie_nfse: Math.max(1, Math.trunc(n(form.serie_nfse))),
        proximo_numero_nfse: Math.max(1, Math.trunc(n(form.proximo_numero_nfse))),
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
          ambiente: padrao?.ambiente ?? "homologacao",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Configuração da prefeitura salva", {
        description: "As próximas notas de serviço dessa loja usam esses dados.",
      });
      qc.invalidateQueries({ queryKey: ["fiscal-config-filiais"] });
      qc.invalidateQueries({ queryKey: ["fiscal-config"] });
      qc.invalidateQueries({ queryKey: ["fiscal-config-certificado"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const texto = (
    id: keyof Form,
    label: string,
    ajuda: string,
    extra?: { sufixo?: string; placeholder?: string },
  ) => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          value={String(form[id] ?? "")}
          placeholder={extra?.placeholder}
          disabled={!isAdmin}
          onChange={(e) => setForm((f) => ({ ...f, [id]: e.target.value }))}
          className={extra?.sufixo ? "pr-7" : ""}
        />
        {extra?.sufixo && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {extra.sufixo}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>
    </div>
  );

  const seletorCst = (id: "cst_pis" | "cst_cofins", label: string) => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={form[id]}
        onValueChange={(v) => setForm((f) => ({ ...f, [id]: v }))}
        disabled={!isAdmin}
      >
        <SelectTrigger id={id}>
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
  );

  if (modulos.carregando) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }
  if (!modulos.locacao) {
    return <ModuloBloqueado modulo="locacao" />;
  }

  return (
    <>
      <PageHeader
        title="Configuração de prefeitura"
        description="Prefeitura, regime tributário e alíquotas de ICMS, PIS, COFINS e ISS de cada loja, usados na nota de serviço."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/impostos-filial">
                <Percent className="size-4" /> Impostos por filial
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/nfe-simulacao">
                <Calculator className="size-4" /> Simular nota
              </Link>
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={!isAdmin || salvar.isPending}>
              <Save className="size-4" /> Salvar configuração
            </Button>
          </div>
        }
      />

      {!isAdmin && (
        <p className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Somente administrador ou gestor pode alterar a configuração da prefeitura.
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
          {propria ? "Configuração própria desta loja" : "Seguindo a configuração da empresa"}
        </Badge>
        <Badge variant="outline">Atividade de locação liberada pelo CNAE</Badge>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : filiais.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Nenhuma loja cadastrada ainda. Cadastre a loja no cadastro da empresa para configurar a
          prefeitura dela.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
            <div className="mb-4 flex items-center gap-2">
              <Landmark className="size-4 text-primary" />
              <p className="font-display text-sm font-semibold">Prefeitura e regime</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="regime_tributario">Regime tributário</Label>
                <Select
                  value={form.regime_tributario}
                  onValueChange={(v) => setForm((f) => ({ ...f, regime_tributario: v }))}
                  disabled={!isAdmin}
                >
                  <SelectTrigger id="regime_tributario">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIMES.map((o) => (
                      <SelectItem key={o.valor} value={o.valor}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Simples usa CSOSN; Presumido e Real usam CST na nota de venda.
                </p>
              </div>
              {texto("nfse_prefeitura", "Prefeitura (município)", "Cidade onde o serviço é prestado.", {
                placeholder: "Franca",
              })}
              {texto("nfse_codigo_municipio", "Código IBGE do município", "Sete dígitos do município.", {
                placeholder: "3516200",
              })}
              <div>
                <Label htmlFor="nfse_padrao">Padrão do sistema da prefeitura</Label>
                <Select
                  value={form.nfse_padrao}
                  onValueChange={(v) => setForm((f) => ({ ...f, nfse_padrao: v }))}
                  disabled={!isAdmin}
                >
                  <SelectTrigger id="nfse_padrao">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PADROES_NFSE.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mb-4 mt-6 flex items-center gap-2 border-t border-border pt-5">
              <Percent className="size-4 text-primary" />
              <p className="font-display text-sm font-semibold">ISS do serviço</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {texto("aliquota_iss", "Alíquota de ISS", "Percentual cobrado pela prefeitura.", {
                sufixo: "%",
              })}
              {texto("codigo_servico", "Código do serviço", "Código usado pela prefeitura.", {
                placeholder: "0703",
              })}
              {texto("item_lista_servico", "Item da lista de serviço", "3.05 é locação de bens móveis.")}
              {texto(
                "nfse_codigo_tributacao",
                "Código de tributação do município",
                "Quando a prefeitura exigir um código próprio.",
              )}
              {texto(
                "nfse_regime_especial",
                "Regime especial de tributação",
                "Deixe vazio se não houver regime especial.",
              )}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">ISS retido pelo tomador</p>
                    <p className="text-xs text-muted-foreground">O cliente recolhe o ISS.</p>
                  </div>
                  <Switch
                    checked={form.nfse_iss_retido}
                    disabled={!isAdmin}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, nfse_iss_retido: v }))}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">Optante do Simples</p>
                    <p className="text-xs text-muted-foreground">Marca a nota como Simples.</p>
                  </div>
                  <Switch
                    checked={form.nfse_optante_simples}
                    disabled={!isAdmin}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, nfse_optante_simples: v }))}
                  />
                </div>
              </div>
            </div>

            <div className="mb-4 mt-6 flex items-center gap-2 border-t border-border pt-5">
              <Percent className="size-4 text-primary" />
              <p className="font-display text-sm font-semibold">ICMS, PIS e COFINS</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {texto("aliquota_icms_interna", "ICMS dentro do estado", "Usado nas notas de venda.", {
                sufixo: "%",
              })}
              {texto(
                "aliquota_icms_interestadual",
                "ICMS para outro estado",
                "Usado quando o cliente é de outro estado.",
                { sufixo: "%" },
              )}
              {texto("aliquota_pis", "PIS", "0,65% no cumulativo e 1,65% no não cumulativo.", {
                sufixo: "%",
              })}
              {texto("aliquota_cofins", "COFINS", "3% no cumulativo e 7,6% no não cumulativo.", {
                sufixo: "%",
              })}
              {seletorCst("cst_pis", "Situação do PIS")}
              {seletorCst("cst_cofins", "Situação do COFINS")}
            </div>

            <div className="mb-4 mt-6 flex items-center gap-2 border-t border-border pt-5">
              <Building2 className="size-4 text-primary" />
              <p className="font-display text-sm font-semibold">Numeração da nota de serviço</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {texto("serie_nfse", "Série da nota de serviço", "Cada loja usa a própria série.")}
              {texto("proximo_numero_nfse", "Próximo número", "Numeração da próxima nota de serviço.")}
            </div>

            <div className="mt-5">
              <Button onClick={() => salvar.mutate()} disabled={!isAdmin || salvar.isPending}>
                <Save className="size-4" /> Salvar configuração
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              <p className="mb-2 font-display text-sm font-semibold text-foreground">
                Como a nota de serviço usa esses dados
              </p>
              <ul className="list-disc space-y-1 pl-4">
                <li>A nota de locação sai como nota de serviço, com ISS em vez de CFOP de venda.</li>
                <li>Se a loja tem configuração própria, ela vale; senão, a da empresa.</li>
                <li>
                  O módulo de locação aparece porque o CNAE da empresa permite aluguel de máquinas e
                  equipamentos.
                </li>
                <li>
                  Falta a inscrição municipal, o código do serviço ou a alíquota de ISS? A nota fica em
                  rascunho mostrando a pendência.
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <p className="font-display text-sm font-semibold">Atividades da empresa</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {modulos.cnaes.length > 0
                  ? modulos.cnaes.join(" · ")
                  : "Nenhum CNAE informado no cadastro da empresa."}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
