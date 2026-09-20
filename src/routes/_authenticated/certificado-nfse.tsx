import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, FileText, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { dateBR } from "@/lib/format";
import { PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/certificado-nfse")({
  head: () => ({
    meta: [
      { title: "Certificado digital e NFS-e — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Informe o certificado digital A1 ou A3 e os dados da prefeitura para emitir nota fiscal de serviço.",
      },
      { property: "og:title", content: "Certificado digital e NFS-e — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Certificado A1 ou A3 e configuração da nota de serviço por prefeitura.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CertificadoNfse,
});

const PADROES = [
  { valor: "abrasf", label: "ABRASF (padrão nacional mais comum)" },
  { valor: "ginfes", label: "GINFES" },
  { valor: "betha", label: "Betha" },
  { valor: "issnet", label: "ISSNet" },
  { valor: "dsf", label: "DSF" },
  { valor: "siat", label: "SIAT" },
  { valor: "webiss", label: "WebISS" },
  { valor: "outro", label: "Outro / prefeitura própria" },
];

const vazio = {
  certificado_tipo: "A1",
  certificado_nome: "",
  certificado_titular: "",
  certificado_validade: "",
  certificado_observacoes: "",
  ambiente: "homologacao",
  nfse_prefeitura: "",
  nfse_padrao: "abrasf",
  nfse_codigo_municipio: "",
  nfse_url: "",
  nfse_usuario: "",
  nfse_token: "",
  nfse_codigo_tributacao: "",
  nfse_regime_especial: "",
  nfse_observacoes: "",
  serie_nfse: "1",
  proximo_numero_nfse: "1",
  nfse_incentivador_cultural: false,
  nfse_optante_simples: true,
  nfse_iss_retido: false,
};

function CertificadoNfse() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const isAdmin = session?.roles.includes("administrador") ?? false;
  const [form, setForm] = useState(vazio);

  const { data: config, isLoading } = useQuery({
    queryKey: ["fiscal-config-certificado"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_config").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!config) return;
    setForm({
      certificado_tipo: config.certificado_tipo ?? "A1",
      certificado_nome: config.certificado_nome ?? "",
      certificado_titular: config.certificado_titular ?? "",
      certificado_validade: config.certificado_validade
        ? String(config.certificado_validade).slice(0, 10)
        : "",
      certificado_observacoes: config.certificado_observacoes ?? "",
      ambiente: config.ambiente ?? "homologacao",
      nfse_prefeitura: config.nfse_prefeitura ?? "",
      nfse_padrao: config.nfse_padrao ?? "abrasf",
      nfse_codigo_municipio: config.nfse_codigo_municipio ?? "",
      nfse_url: config.nfse_url ?? "",
      nfse_usuario: config.nfse_usuario ?? "",
      nfse_token: config.nfse_token ?? "",
      nfse_codigo_tributacao: config.nfse_codigo_tributacao ?? "",
      nfse_regime_especial: config.nfse_regime_especial ?? "",
      nfse_observacoes: config.nfse_observacoes ?? "",
      serie_nfse: String(config.serie_nfse ?? 1),
      proximo_numero_nfse: String(config.proximo_numero_nfse ?? 1),
      nfse_incentivador_cultural: Boolean(config.nfse_incentivador_cultural),
      nfse_optante_simples: config.nfse_optante_simples ?? true,
      nfse_iss_retido: Boolean(config.nfse_iss_retido),
    });
  }, [config]);

  const salvar = useMutation({
    mutationFn: async () => {
      const tenantId = session?.profile?.tenant_id;
      if (!tenantId) throw new Error("Perfil sem empresa vinculada");
      const payload = {
        certificado_tipo: form.certificado_tipo,
        certificado_nome: form.certificado_nome || null,
        certificado_titular: form.certificado_titular || null,
        certificado_validade: form.certificado_validade || null,
        certificado_observacoes: form.certificado_observacoes || null,
        ambiente: form.ambiente,
        nfse_prefeitura: form.nfse_prefeitura || null,
        nfse_padrao: form.nfse_padrao || null,
        nfse_codigo_municipio: form.nfse_codigo_municipio || null,
        nfse_url: form.nfse_url || null,
        nfse_usuario: form.nfse_usuario || null,
        nfse_token: form.nfse_token || null,
        nfse_codigo_tributacao: form.nfse_codigo_tributacao || null,
        nfse_regime_especial: form.nfse_regime_especial || null,
        nfse_observacoes: form.nfse_observacoes || null,
        serie_nfse: Number(form.serie_nfse) || 1,
        proximo_numero_nfse: Number(form.proximo_numero_nfse) || 1,
        nfse_incentivador_cultural: form.nfse_incentivador_cultural,
        nfse_optante_simples: form.nfse_optante_simples,
        nfse_iss_retido: form.nfse_iss_retido,
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
      toast.success("Configuração salva");
      void qc.invalidateQueries({ queryKey: ["fiscal-config-certificado"] });
      void qc.invalidateQueries({ queryKey: ["fiscal-config-impostos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (campo: keyof typeof vazio, valor: string | boolean) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  const vencido =
    !!form.certificado_validade && form.certificado_validade < new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Certificado digital e NFS-e"
        description="Informe o certificado A1 ou A3 da empresa e os dados da prefeitura para emitir nota fiscal de serviço."
        actions={
          isAdmin ? (
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || isLoading}>
              <Save className="size-4" /> Salvar configuração
            </Button>
          ) : undefined
        }
      />

      {!isAdmin && (
        <div className="panel mb-5 p-4 text-sm text-muted-foreground">
          Somente o administrador da empresa pode alterar estes dados.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="panel p-4">
          <h2 className="mb-1 flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-4 text-primary" /> Certificado digital
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            O A1 é um arquivo instalado no servidor de emissão; o A3 fica em cartão ou token e precisa
            estar conectado na máquina que emite.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Tipo</Label>
              <Select
                value={form.certificado_tipo}
                onValueChange={(v) => set("certificado_tipo", v)}
                disabled={!isAdmin}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A1">A1 — arquivo (.pfx), válido por 1 ano</SelectItem>
                  <SelectItem value="A3">A3 — cartão ou token, válido por até 3 anos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Validade</Label>
              <Input
                type="date"
                value={form.certificado_validade}
                onChange={(e) => set("certificado_validade", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div>
              <Label>Titular (nome no certificado)</Label>
              <Input
                value={form.certificado_titular}
                onChange={(e) => set("certificado_titular", e.target.value)}
                placeholder="CONSTRULAR MATERIAIS LTDA:12345678000199"
                disabled={!isAdmin}
              />
            </div>
            <div>
              <Label>Identificação do arquivo ou token</Label>
              <Input
                value={form.certificado_nome}
                onChange={(e) => set("certificado_nome", e.target.value)}
                placeholder="certificado-2026.pfx"
                disabled={!isAdmin}
              />
            </div>
            <div>
              <Label>Ambiente de emissão</Label>
              <Select value={form.ambiente} onValueChange={(v) => set("ambiente", v)} disabled={!isAdmin}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="homologacao">Homologação (teste)</SelectItem>
                  <SelectItem value="producao">Produção (vale para o fisco)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Observações</Label>
              <Textarea
                rows={2}
                value={form.certificado_observacoes}
                onChange={(e) => set("certificado_observacoes", e.target.value)}
                placeholder="Onde o certificado está instalado, quem tem a senha, data de renovação."
                disabled={!isAdmin}
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {form.certificado_validade ? (
              vencido ? (
                <Badge className="bg-destructive/15 text-destructive">
                  Vencido em {dateBR(form.certificado_validade)}
                </Badge>
              ) : (
                <Badge className="bg-primary/15 text-primary">
                  Válido até {dateBR(form.certificado_validade)}
                </Badge>
              )
            ) : (
              <Badge variant="secondary">Validade não informada</Badge>
            )}
            <span className="text-muted-foreground">
              O arquivo e a senha do certificado ficam com o emissor autorizado — aqui guardamos só os
              dados de controle.
            </span>
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="mb-1 flex items-center gap-2 font-semibold">
            <Building2 className="size-4 text-primary" /> Nota de serviço por prefeitura
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Cada prefeitura tem seu próprio sistema de NFS-e. Informe o município, o padrão e o acesso
            que a prefeitura liberou para a empresa.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Prefeitura (município)</Label>
              <Input
                value={form.nfse_prefeitura}
                onChange={(e) => set("nfse_prefeitura", e.target.value)}
                placeholder="Ribeirão Preto"
                disabled={!isAdmin}
              />
            </div>
            <div>
              <Label>Código do município (IBGE)</Label>
              <Input
                value={form.nfse_codigo_municipio}
                onChange={(e) => set("nfse_codigo_municipio", e.target.value)}
                placeholder="3543402"
                disabled={!isAdmin}
              />
            </div>
            <div>
              <Label>Padrão do sistema</Label>
              <Select value={form.nfse_padrao} onValueChange={(v) => set("nfse_padrao", v)} disabled={!isAdmin}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PADROES.map((p) => (
                    <SelectItem key={p.valor} value={p.valor}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Endereço do serviço (URL)</Label>
              <Input
                value={form.nfse_url}
                onChange={(e) => set("nfse_url", e.target.value)}
                placeholder="https://nfse.prefeitura.gov.br/ws"
                disabled={!isAdmin}
              />
            </div>
            <div>
              <Label>Usuário / inscrição no portal</Label>
              <Input
                value={form.nfse_usuario}
                onChange={(e) => set("nfse_usuario", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div>
              <Label>Token ou senha do portal</Label>
              <Input
                type="password"
                value={form.nfse_token}
                onChange={(e) => set("nfse_token", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div>
              <Label>Código de tributação do município</Label>
              <Input
                value={form.nfse_codigo_tributacao}
                onChange={(e) => set("nfse_codigo_tributacao", e.target.value)}
                placeholder="770200"
                disabled={!isAdmin}
              />
            </div>
            <div>
              <Label>Regime especial de tributação</Label>
              <Input
                value={form.nfse_regime_especial}
                onChange={(e) => set("nfse_regime_especial", e.target.value)}
                placeholder="Microempresa municipal, estimativa, etc."
                disabled={!isAdmin}
              />
            </div>
            <div>
              <Label>Série da NFS-e</Label>
              <Input
                value={form.serie_nfse}
                onChange={(e) => set("serie_nfse", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div>
              <Label>Próximo número</Label>
              <Input
                value={form.proximo_numero_nfse}
                onChange={(e) => set("proximo_numero_nfse", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <label className="flex items-center justify-between rounded-md border p-2 text-sm">
                Optante do Simples Nacional
                <Switch
                  checked={form.nfse_optante_simples}
                  onCheckedChange={(v) => set("nfse_optante_simples", v)}
                  disabled={!isAdmin}
                />
              </label>
              <label className="flex items-center justify-between rounded-md border p-2 text-sm">
                Incentivador cultural
                <Switch
                  checked={form.nfse_incentivador_cultural}
                  onCheckedChange={(v) => set("nfse_incentivador_cultural", v)}
                  disabled={!isAdmin}
                />
              </label>
              <label className="flex items-center justify-between rounded-md border p-2 text-sm">
                ISS retido pelo tomador
                <Switch
                  checked={form.nfse_iss_retido}
                  onCheckedChange={(v) => set("nfse_iss_retido", v)}
                  disabled={!isAdmin}
                />
              </label>
            </div>
            <div className="sm:col-span-2">
              <Label>Observações da nota de serviço</Label>
              <Textarea
                rows={2}
                value={form.nfse_observacoes}
                onChange={(e) => set("nfse_observacoes", e.target.value)}
                placeholder="Texto que sai no corpo da NFS-e."
                disabled={!isAdmin}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="panel mt-5 p-4 text-sm">
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          <FileText className="size-4 text-primary" /> Como isso entra na nota
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            A locação de equipamento sai como NFS-e de serviço; a venda de produto continua saindo como
            NF-e.
          </li>
          <li>
            O código do serviço e a alíquota de ISS vêm de{" "}
            <Link to="/impostos" className="text-primary underline">
              Impostos da empresa
            </Link>{" "}
            e de{" "}
            <Link to="/impostos-filial" className="text-primary underline">
              Impostos por filial
            </Link>{" "}
            — a loja emitente tem prioridade.
          </li>
          <li>
            Sem certificado válido, inscrição municipal e código do serviço, a nota fica em rascunho e o
            sistema mostra a pendência.
          </li>
        </ul>
      </div>
    </div>
  );
}
