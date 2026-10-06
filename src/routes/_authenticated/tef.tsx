import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/tef")({
  head: () => ({
    meta: [
      { title: "Maquininha (TEF) — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Configuração da maquininha de cartão: credenciadora, contrato, terminal e parâmetros.",
      },
      { property: "og:title", content: "Maquininha (TEF) — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Ligue a venda de cartão da frente de caixa à maquininha da loja.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TefPage,
});

export const CREDENCIADORAS = [
  { v: "stone", l: "Stone" },
  { v: "cielo", l: "Cielo" },
  { v: "rede", l: "Rede" },
  { v: "getnet", l: "Getnet" },
  { v: "pagseguro", l: "PagSeguro / PagBank" },
  { v: "mercadopago", l: "Mercado Pago" },
  { v: "sipag", l: "Sipag / Sicredi" },
  { v: "outra", l: "Outra" },
];

const vazio = {
  credenciadora: "stone",
  modo: "manual",
  contrato: "",
  codigo_estabelecimento: "",
  terminal_id: "",
  cnpj_credenciadora: "",
  ponte_url: "http://localhost:60906",
  parcelas_max: "12",
  parcelas_sem_juros: "3",
  taxa_debito: "0",
  taxa_credito: "0",
  taxa_parcelado: "0",
  exigir_nsu: true,
  ativo: true,
  observacoes: "",
};

function TefPage() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const filiais = session?.filiais ?? [];
  const pode = (session?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  const [filialId, setFilialId] = useState("");
  const [f, setF] = useState(vazio);
  const [teste, setTeste] = useState<string | null>(null);

  useEffect(() => {
    if (!filialId && filiais[0]) setFilialId(filiais[0].id);
  }, [filiais, filialId]);

  const { data: cfg } = useQuery({
    queryKey: ["tef-config", filialId],
    enabled: !!filialId,
    queryFn: async () => {
      const { data } = await supabase
        .from("tef_config" as never)
        .select("*")
        .eq("filial_id", filialId)
        .maybeSingle();
      return data as Record<string, unknown> | null;
    },
  });
  useEffect(() => {
    if (!cfg) {
      setF(vazio);
      return;
    }
    setF(
      Object.fromEntries(
        Object.entries(vazio).map(([k, d]) => [
          k,
          typeof d === "boolean" ? Boolean(cfg[k]) : String(cfg[k] ?? ""),
        ]),
      ) as typeof vazio,
    );
  }, [cfg]);

  const salvar = useMutation({
    mutationFn: async () => {
      const n = (s: string) => Number(s.replace(",", ".")) || 0;
      const row = {
        tenant_id: session?.profile?.tenant_id,
        filial_id: filialId,
        credenciadora: f.credenciadora,
        modo: f.modo,
        contrato: f.contrato || null,
        codigo_estabelecimento: f.codigo_estabelecimento || null,
        terminal_id: f.terminal_id || null,
        cnpj_credenciadora: f.cnpj_credenciadora || null,
        ponte_url: f.ponte_url || null,
        parcelas_max: Math.max(1, Math.round(n(f.parcelas_max))),
        parcelas_sem_juros: Math.max(1, Math.round(n(f.parcelas_sem_juros))),
        taxa_debito: n(f.taxa_debito),
        taxa_credito: n(f.taxa_credito),
        taxa_parcelado: n(f.taxa_parcelado),
        exigir_nsu: f.exigir_nsu,
        ativo: f.ativo,
        observacoes: f.observacoes || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("tef_config" as never)
        .upsert(row as never, { onConflict: "tenant_id,filial_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuração da maquininha salva");
      void qc.invalidateQueries({ queryKey: ["tef-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function testarPonte() {
    setTeste("Testando…");
    try {
      const r = await fetch(`${f.ponte_url.replace(/\/$/, "")}/status`, {
        signal: AbortSignal.timeout(4000),
      });
      setTeste(
        r.ok
          ? "Programa de ponte respondeu: maquininha conectada."
          : `Programa respondeu com erro (${r.status}).`,
      );
    } catch {
      setTeste(
        "Programa de ponte não encontrado neste computador. Instale o programa da credenciadora e deixe-o aberto.",
      );
    }
  }

  const campo = (k: keyof typeof vazio, label: string, ph = "") => (
    <div>
      <Label>{label}</Label>
      <Input
        disabled={!pode}
        placeholder={ph}
        value={String(f[k])}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
      />
    </div>
  );
  const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";

  return (
    <div>
      <PageHeader
        title="Maquininha de cartão (TEF)"
        description="Credenciadora, contrato e parâmetros para ligar a venda de cartão da frente de caixa à maquininha."
      />
      {!pode && (
        <p className="mb-3 text-sm text-muted-foreground">
          Somente administrador ou gestor altera esta configuração.
        </p>
      )}
      <div className="panel mb-4 grid gap-3 p-4 md:grid-cols-3">
        <div>
          <Label>Loja</Label>
          <select className={sel} value={filialId} onChange={(e) => setFilialId(e.target.value)}>
            {filiais.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Credenciadora</Label>
          <select
            className={sel}
            disabled={!pode}
            value={f.credenciadora}
            onChange={(e) => setF({ ...f, credenciadora: e.target.value })}
          >
            {CREDENCIADORAS.map((c) => (
              <option key={c.v} value={c.v}>
                {c.l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Forma de ligação</Label>
          <select
            className={sel}
            disabled={!pode}
            value={f.modo}
            onChange={(e) => setF({ ...f, modo: e.target.value })}
          >
            <option value="manual">Maquininha separada (digitar o código da transação)</option>
            <option value="ponte">Programa de ponte no computador (TEF)</option>
            <option value="nuvem">Maquininha ligada pela internet</option>
            <option value="simulado">Simulado (teste, sem cobrança real)</option>
          </select>
        </div>
        {campo("contrato", "Número do contrato")}
        {campo("codigo_estabelecimento", "Código do estabelecimento")}
        {campo("terminal_id", "Número do terminal / maquininha")}
        {campo("cnpj_credenciadora", "CNPJ da credenciadora")}
        {f.modo === "ponte" &&
          campo("ponte_url", "Endereço do programa de ponte", "http://localhost:60906")}
        {campo("parcelas_max", "Máximo de parcelas")}
        {campo("parcelas_sem_juros", "Parcelas sem juros")}
        {campo("taxa_debito", "Taxa débito (%)")}
        {campo("taxa_credito", "Taxa crédito à vista (%)")}
        {campo("taxa_parcelado", "Taxa crédito parcelado (%)")}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={!pode}
            checked={f.exigir_nsu}
            onChange={(e) => setF({ ...f, exigir_nsu: e.target.checked })}
          />{" "}
          Exigir código da transação (NSU) na venda de cartão
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={!pode}
            checked={f.ativo}
            onChange={(e) => setF({ ...f, ativo: e.target.checked })}
          />{" "}
          Maquininha ativa
        </label>
        <div className="md:col-span-3">
          <Label>Observações</Label>
          <Textarea
            disabled={!pode}
            value={f.observacoes}
            onChange={(e) => setF({ ...f, observacoes: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap gap-2 md:col-span-3">
          {pode && (
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !filialId}>
              Salvar configuração
            </Button>
          )}
          {f.modo === "ponte" && (
            <Button variant="outline" onClick={testarPonte}>
              Testar programa de ponte
            </Button>
          )}
          {teste && <span className="self-center text-sm text-muted-foreground">{teste}</span>}
        </div>
      </div>
    </div>
  );
}
