import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { faltaParaEmitir, validarConfigNfce } from "@/lib/nfce-config";

export const Route = createFileRoute("/_authenticated/nfce-config")({
  head: () => ({
    meta: [
      { title: "Configuração da NFC-e — ERP Ze Tech" },
      {
        name: "description",
        content: "Código e token do CSC, série e contingência da nota fiscal do consumidor.",
      },
    ],
  }),
  component: NfceConfig,
});

type Linha = {
  fiscal_config_id: string;
  filial_nome: string;
  ambiente: string;
  emissor: string | null;
  certificado_nome: string | null;
  serie: number;
  proximo_numero: number;
  csc_id: string | null;
  csc_configurado: boolean;
  contingencia_ativa: boolean;
};

function NfceConfig() {
  const { data: sessao } = useSessionData();
  const pode = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");

  const {
    data: linhas = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["nfce-config"],
    enabled: pode,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("nfce_config_listar");
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
  });

  if (sessao && !pode) {
    return (
      <div>
        <PageHeader title="Configuração da NFC-e" />
        <EmptyState
          title="Acesso restrito"
          description="Somente administrador e gestor configuram a NFC-e."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Configuração da NFC-e"
        description="O CSC (código de segurança do contribuinte) é gerado no portal da Sefaz do seu estado. Informe o código e o token aqui; o token fica guardado e não volta a aparecer na tela."
      />
      {error ? (
        <EmptyState
          title="Não foi possível carregar"
          description={error instanceof Error ? error.message : "Tente de novo."}
        />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : linhas.length === 0 ? (
        <EmptyState
          title="Nenhuma configuração fiscal"
          description="Salve o cadastro da empresa primeiro; a configuração fiscal nasce junto com ele."
        />
      ) : (
        <div className="space-y-4">
          {linhas.map((l) => (
            <CartaoNfce key={l.fiscal_config_id} linha={l} />
          ))}
        </div>
      )}
    </div>
  );
}

function CartaoNfce({ linha }: { linha: Linha }) {
  const qc = useQueryClient();
  const [serie, setSerie] = useState(String(linha.serie));
  const [cscId, setCscId] = useState(linha.csc_id ?? "");
  const [cscToken, setCscToken] = useState("");
  const [contingencia, setContingencia] = useState(linha.contingencia_ativa);
  const falta = faltaParaEmitir(linha);

  const salvar = useMutation({
    mutationFn: async () => {
      const problema = validarConfigNfce({ serie, cscId, cscToken }, linha.csc_configurado);
      if (problema) throw new Error(problema);
      const { error } = await supabase.rpc("nfce_config_salvar", {
        p_fiscal_config_id: linha.fiscal_config_id,
        p_serie: Number(serie),
        p_csc_id: cscId.trim(),
        ...(cscToken.trim() ? { p_csc_token: cscToken.trim() } : {}),
        p_contingencia: contingencia,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCscToken("");
      void qc.invalidateQueries({ queryKey: ["nfce-config"] });
      toast.success("Configuração da NFC-e salva");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar"),
  });

  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{linha.filial_nome}</h2>
        <Badge variant="outline">
          {linha.ambiente === "producao" ? "Produção" : "Homologação"}
        </Badge>
        {falta.length === 0 ? (
          <Badge className="bg-success/15 text-success">Pronta para emitir</Badge>
        ) : (
          <Badge className="bg-warning/15 text-warning">Falta: {falta.join(", ")}</Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor={`serie-${linha.fiscal_config_id}`}>Série</Label>
          <Input
            id={`serie-${linha.fiscal_config_id}`}
            className="mt-1"
            inputMode="numeric"
            value={serie}
            onChange={(e) => setSerie(e.target.value)}
          />
        </div>
        <div>
          <Label>Próximo número</Label>
          <Input className="mt-1" value={linha.proximo_numero} disabled />
          <p className="mt-1 text-xs text-muted-foreground">Controlado pelo sistema.</p>
        </div>
        <div>
          <Label htmlFor={`csc-${linha.fiscal_config_id}`}>Código do CSC</Label>
          <Input
            id={`csc-${linha.fiscal_config_id}`}
            className="mt-1"
            inputMode="numeric"
            placeholder="Ex.: 1"
            value={cscId}
            onChange={(e) => setCscId(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`tok-${linha.fiscal_config_id}`}>Token do CSC</Label>
          <Input
            id={`tok-${linha.fiscal_config_id}`}
            className="mt-1"
            type="password"
            autoComplete="off"
            placeholder={
              linha.csc_configurado ? "Guardado — digite só para trocar" : "Cole o token"
            }
            value={cscToken}
            onChange={(e) => setCscToken(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={contingencia} onCheckedChange={setContingencia} />
          Emitir em contingência (use só se a Sefaz estiver fora do ar)
        </label>
        <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
          <Save className="mr-1 h-4 w-4" />
          {salvar.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </section>
  );
}
