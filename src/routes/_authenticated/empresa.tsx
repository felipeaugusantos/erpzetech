import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
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
import { ramos } from "@/lib/ramo";
import {
  COR_PADRAO,
  LogoEmpresaUpload,
  aplicarCorEmpresa,
} from "@/components/app/MarcaEmpresa";

export const Route = createFileRoute("/_authenticated/empresa")({
  head: () => ({
    meta: [
      { title: "Cadastro da empresa — ERP Ze Tech" },
      {
        name: "description",
        content: "Dados cadastrais, endereço e regime tributário da empresa no ERP Ze Tech.",
      },
      { property: "og:title", content: "Cadastro da empresa — ERP Ze Tech" },
      { property: "og:description", content: "Informe CNPJ, inscrições e regime tributário." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Empresa,
});

/** Regimes tributários aceitos na emissão fiscal. */
const regimes = [
  { value: "simples", label: "Simples Nacional" },
  { value: "simples_excesso", label: "Simples Nacional — excesso de sublimite" },
  { value: "presumido", label: "Lucro Presumido" },
  { value: "real", label: "Lucro Real" },
  { value: "mei", label: "MEI" },
] as const;

const vazio = {
  razao_social: "",
  nome_fantasia: "",
  cnpj: "",
  inscricao_estadual: "",
  inscricao_municipal: "",
  cnae: "",
  regime_tributario: "simples",
  ramo_atividade: "construcao",
  telefone: "",
  email: "",
  cep: "",
  endereco: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  estado: "",
  codigo_municipio: "",
};

/** Sugestões de cor para a marca da loja. */
const coresSugeridas = ["#008037", "#0f62fe", "#b42318", "#7a5af8", "#ef6c00", "#0f172a"];

function Empresa() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const isAdmin = session?.roles.includes("administrador") ?? false;
  const [form, setForm] = useState(vazio);
  /** Identidade visual da loja: logo e cor principal do sistema. */
  const [marca, setMarca] = useState<{ logo: string | null; cor: string }>({
    logo: null,
    cor: COR_PADRAO,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["empresa-cadastro"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      razao_social: data.razao_social ?? "",
      nome_fantasia: data.nome_fantasia ?? "",
      cnpj: data.cnpj ?? "",
      inscricao_estadual: data.inscricao_estadual ?? "",
      inscricao_municipal: data.inscricao_municipal ?? "",
      cnae: data.cnae ?? "",
      regime_tributario: data.regime_tributario ?? "simples",
      ramo_atividade: data.ramo_atividade ?? "construcao",
      telefone: data.telefone ?? "",
      email: data.email ?? "",
      cep: data.cep ?? "",
      endereco: data.endereco ?? "",
      numero: data.numero ?? "",
      complemento: data.complemento ?? "",
      bairro: data.bairro ?? "",
      cidade: data.cidade ?? "",
      estado: data.estado ?? "",
      codigo_municipio: data.codigo_municipio ?? "",
    });
    setMarca({ logo: data.logo_path ?? null, cor: data.cor_primaria ?? COR_PADRAO });
  }, [data]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.razao_social.trim()) throw new Error("Informe a razão social");
      const tenantId = session?.profile?.tenant_id;
      if (!tenantId) throw new Error("Perfil sem empresa vinculada");

      const payload = { ...form, logo_path: marca.logo, cor_primaria: marca.cor };

      let empresaId = data?.id ?? null;
      if (empresaId) {
        const { error } = await supabase.from("empresas").update(payload).eq("id", empresaId);
        if (error) throw error;
      } else {
        const criada = await supabase
          .from("empresas")
          .insert({ ...payload, tenant_id: tenantId })
          .select("id")
          .single();
        if (criada.error) throw criada.error;
        empresaId = criada.data.id;
        // O administrador do primeiro acesso passa a pertencer à empresa cadastrada.
        const vinculo = await supabase
          .from("profiles")
          .update({ empresa_id: empresaId })
          .eq("id", session!.user.id);
        if (vinculo.error) throw vinculo.error;
      }

      // Mantém o regime usado na emissão fiscal igual ao do cadastro.
      const cfg = await supabase
        .from("fiscal_config")
        .select("id")
        .eq("empresa_id", empresaId)
        .maybeSingle();
      if (cfg.data?.id) {
        await supabase
          .from("fiscal_config")
          .update({ regime_tributario: form.regime_tributario })
          .eq("id", cfg.data.id);
      } else {
        await supabase.from("fiscal_config").insert({
          tenant_id: tenantId,
          empresa_id: empresaId,
          regime_tributario: form.regime_tributario,
        });
      }
    },
    onSuccess: () => {
      toast.success(data ? "Dados da empresa salvos" : "Empresa cadastrada");
      // A nova cor passa a valer na hora, sem precisar recarregar.
      aplicarCorEmpresa(marca.cor);
      qc.invalidateQueries({ queryKey: ["empresa-cadastro"] });
      qc.invalidateQueries({ queryKey: ["configuracoes"] });
      qc.invalidateQueries({ queryKey: ["session-data"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const campo = (
    id: keyof typeof vazio,
    label: string,
    extra?: { maxLength?: number; upper?: boolean },
  ) => (
    <div>
      <Label htmlFor={`emp-${id}`}>{label}</Label>
      <Input
        id={`emp-${id}`}
        value={form[id]}
        maxLength={extra?.maxLength}
        disabled={!isAdmin}
        onChange={(e) =>
          setForm({ ...form, [id]: extra?.upper ? e.target.value.toUpperCase() : e.target.value })
        }
      />
    </div>
  );

  return (
    <>
      <PageHeader
        title="Cadastro da empresa"
        description="Dados cadastrais, endereço e regime tributário usados em documentos e notas fiscais."
      />

      {!isAdmin && (
        <p className="mb-3 text-sm text-muted-foreground">
          Somente o administrador da empresa pode alterar estes dados.
        </p>
      )}

      {isLoading ? (
        <div className="panel h-72 animate-pulse" />
      ) : (
        <div className="panel max-w-4xl p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-md bg-secondary">
              <Building2 className="size-4" />
            </span>
            <div>
              <p className="font-display text-sm font-semibold">
                {data ? "Dados da empresa" : "Primeiro acesso — cadastre sua empresa"}
              </p>
              <p className="text-xs text-muted-foreground">
                Esses dados aparecem em orçamentos, pedidos, cupons e notas fiscais.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campo("razao_social", "Razão social")}
            {campo("nome_fantasia", "Nome fantasia")}
            {campo("cnpj", "CNPJ")}
            {campo("inscricao_estadual", "Inscrição estadual")}
            {campo("inscricao_municipal", "Inscrição municipal")}
            {campo("cnae", "CNAE principal")}

            <div>
              <Label htmlFor="emp-regime">Regime tributário</Label>
              <Select
                value={form.regime_tributario}
                disabled={!isAdmin}
                onValueChange={(v) => setForm({ ...form, regime_tributario: v })}
              >
                <SelectTrigger id="emp-regime" aria-label="Regime tributário">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {regimes.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Define o CRT e a tributação usada na emissão das notas.
              </p>
            </div>

            <div>
              <Label htmlFor="emp-ramo">Ramo de atividade</Label>
              <Select
                value={form.ramo_atividade}
                disabled={!isAdmin}
                onValueChange={(v) => setForm({ ...form, ramo_atividade: v })}
              >
                <SelectTrigger id="emp-ramo" aria-label="Ramo de atividade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ramos.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {campo("telefone", "Telefone")}
            {campo("email", "E-mail")}
            {campo("cep", "CEP")}
            {campo("endereco", "Endereço")}
            {campo("numero", "Número")}
            {campo("complemento", "Complemento")}
            {campo("bairro", "Bairro")}
            {campo("cidade", "Cidade")}
            {campo("estado", "Estado", { maxLength: 2, upper: true })}
            {campo("codigo_municipio", "Código IBGE do município")}
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <p className="font-display text-sm font-semibold">Identidade da loja</p>
            <p className="mb-3 text-xs text-muted-foreground">
              A logo e a cor escolhidas aparecem já na abertura do sistema, no menu e nos
              documentos.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="mb-2 block">Logo da empresa</Label>
                <LogoEmpresaUpload
                  caminho={marca.logo}
                  tenantId={session?.profile?.tenant_id}
                  podeEditar={isAdmin}
                  onChange={(logo) => setMarca((m) => ({ ...m, logo }))}
                />
              </div>

              <div>
                <Label htmlFor="emp-cor" className="mb-2 block">
                  Cor principal
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    id="emp-cor"
                    type="color"
                    aria-label="Cor principal"
                    value={marca.cor}
                    disabled={!isAdmin}
                    onChange={(e) => setMarca((m) => ({ ...m, cor: e.target.value }))}
                    className="size-10 cursor-pointer rounded-md border border-border bg-transparent p-1"
                  />
                  <Input
                    value={marca.cor}
                    disabled={!isAdmin}
                    maxLength={7}
                    onChange={(e) => setMarca((m) => ({ ...m, cor: e.target.value }))}
                    className="w-32 font-mono"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!isAdmin}
                    onClick={() => setMarca((m) => ({ ...m, cor: COR_PADRAO }))}
                  >
                    Padrão
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {coresSugeridas.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Usar a cor ${c}`}
                      disabled={!isAdmin}
                      onClick={() => setMarca((m) => ({ ...m, cor: c }))}
                      className="size-7 rounded-full border-2 border-border"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Use o código da cor da sua marca (ex.: #008037).
                </p>
              </div>
            </div>
          </div>


          <div className="mt-5">
            <Button
              onClick={() => salvar.mutate()}
              disabled={!isAdmin || salvar.isPending || !form.razao_social.trim()}
            >
              {data ? "Salvar empresa" : "Cadastrar empresa"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
