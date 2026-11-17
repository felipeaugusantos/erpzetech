import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ModeloMensagem } from "@/components/app/ModeloMensagem";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { PainelRelacionamentoClinica } from "@/components/app/PainelRelacionamentoClinica";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { MENSAGEM_PADRAO } from "@/lib/contato-pet";
import { dateTimeBR } from "@/lib/format";
import {
  whatsappAtualizar,
  whatsappConectar,
  whatsappDesconectar,
  type ResultadoConexao,
} from "@/lib/whatsapp.functions";
import { rotuloEvidencia } from "@/lib/relacionamento-clinica";
import { ROTULO_AVISO_CLINICA } from "@/lib/whatsapp-despacho";

export const Route = createFileRoute("/_authenticated/clinica-whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp da clínica — EZRA ERP" },
      {
        name: "description",
        content:
          "Lembretes de vacina e de retorno de consulta enviados pelo sistema no WhatsApp da clínica.",
      },
    ],
  }),
  component: WhatsAppClinicaModulo,
});

function WhatsAppClinicaModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <WhatsAppClinica />;
}

type Config = {
  estado: "conectada" | "desconectada" | "conectando";
  numero: string | null;
  auto_reforco: boolean;
  auto_retorno: boolean;
  reforco_dias_antes: number;
  reforco_dias_atraso: number;
  retorno_dias_antes: number;
};

type Linha = {
  id: string;
  tipo: string;
  situacao: string;
  origem: string;
  erro: string | null;
  tentativas: number;
  created_at: string;
  enviada_em: string | null;
  numero: string;
  variaveis: { cliente?: string; pet?: string; data?: string; itens?: string };
};

function WhatsAppClinica() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const gestor = (session?.roles ?? []).some((r) => ["administrador", "gestor"].includes(r));
  const podeRegras = (session?.roles ?? []).some((r) =>
    ["administrador", "gestor", "veterinario"].includes(r),
  );
  const conectar = useServerFn(whatsappConectar);
  const atualizar = useServerFn(whatsappAtualizar);
  const desconectar = useServerFn(whatsappDesconectar);
  const [conexao, setConexao] = useState<ResultadoConexao | null>(null);
  const [modeloRetorno, setModeloRetorno] = useState(MENSAGEM_PADRAO.retorno_clinica);

  const { data: config, isLoading } = useQuery({
    queryKey: ["wa-config-clinica"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_config")
        .select(
          "estado, numero, auto_reforco, auto_retorno, reforco_dias_antes, reforco_dias_atraso, retorno_dias_antes",
        )
        .maybeSingle();
      if (error) throw error;
      return (data as Config | null) ?? null;
    },
  });
  const estado = conexao?.estado ?? config?.estado ?? "desconectada";

  const { data: mensagens = [] } = useQuery({
    queryKey: ["wa-mensagens-clinica"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_mensagens")
        .select(
          "id, tipo, situacao, origem, erro, tentativas, created_at, enviada_em, numero, variaveis",
        )
        .in("tipo", ["reforco_vacina", "retorno_consulta"])
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as unknown as Linha[];
    },
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["wa-config-clinica"] });
    void qc.invalidateQueries({ queryKey: ["wa-mensagens-clinica"] });
    void qc.invalidateQueries({ queryKey: ["clinica-reforcos"] });
  };

  const iniciar = useMutation({
    mutationFn: () => conectar(),
    onSuccess: (r) => {
      setConexao(r);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sair = useMutation({
    mutationFn: () => desconectar(),
    onSuccess: () => {
      setConexao(null);
      toast.success("WhatsApp desconectado.");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // enquanto espera a leitura do QR code, pergunta ao servidor a cada 4 segundos (o QR troca de tempos em tempos)
  const esperando =
    conexao?.estado === "conectando" || (config?.estado === "conectando" && !!conexao);
  useEffect(() => {
    if (!esperando) return;
    const t = setInterval(() => {
      atualizar()
        .then((r) => {
          setConexao(r);
          if (r.estado === "conectada") {
            toast.success("WhatsApp conectado.");
            refresh();
          }
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esperando]);

  const [dias, setDias] = useState({ reforcoAntes: 3, reforcoAtraso: 7, retornoAntes: 2 });
  useEffect(() => {
    if (config)
      setDias({
        reforcoAntes: config.reforco_dias_antes,
        reforcoAtraso: config.reforco_dias_atraso,
        retornoAntes: config.retorno_dias_antes,
      });
  }, [config]);

  const automatico = useMutation({
    mutationFn: async (p: { reforco: boolean; retorno: boolean; aviso?: boolean }) => {
      const { error } = await supabase.rpc("clinica_wa_regras_salvar", {
        p_reforco: p.reforco,
        p_retorno: p.retorno,
        p_reforco_antes: dias.reforcoAntes,
        p_reforco_atraso: dias.reforcoAtraso,
        p_retorno_antes: dias.retornoAntes,
      });
      if (error) throw error;
      return p.aviso;
    },
    onSuccess: (aviso) => {
      if (aviso) toast.success("Regras de envio salvas.");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const acao = useMutation({
    mutationFn: async (p: {
      id: string;
      qual: "clinica_wa_mensagem_cancelar" | "clinica_wa_mensagem_reenviar";
    }) => {
      const { error } = await supabase.rpc(p.qual, { p_id: p.id });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const qr = conexao?.qrBase64
    ? conexao.qrBase64.startsWith("data:")
      ? conexao.qrBase64
      : `data:image/png;base64,${conexao.qrBase64}`
    : null;

  return (
    <div>
      <PageHeader
        title="WhatsApp da clínica"
        description="Lembretes de vacina e de retorno enviados pelo sistema, na mesma conexão de WhatsApp da empresa. Use um número só da clínica: a conexão é pelo WhatsApp Web, não oficial, e o WhatsApp pode restringir números que enviam em excesso."
      />

      <div className="panel mb-6 max-w-2xl space-y-3 p-4">
        <h2 className="text-sm font-semibold">Conexão</h2>
        {isLoading ? (
          <div className="h-10 animate-pulse rounded bg-muted" />
        ) : (
          <p className="text-sm">
            {estado === "conectada"
              ? `Conectado${config?.numero ? ` · número ${config.numero}` : ""}`
              : estado === "conectando"
                ? "Aguardando a leitura do QR code…"
                : "Desconectado"}
          </p>
        )}
        {qr && estado === "conectando" && (
          <div className="space-y-2">
            <img
              src={qr}
              alt="QR code para conectar o WhatsApp"
              className="size-56 rounded border bg-white p-2"
            />
            <p className="text-xs text-muted-foreground">
              No celular da clínica: WhatsApp › Aparelhos conectados › Conectar um aparelho, e leia
              este código.
              {conexao?.codigoPareamento
                ? ` Código de pareamento: ${conexao.codigoPareamento}.`
                : ""}
            </p>
          </div>
        )}
        {gestor ? (
          <div className="flex flex-wrap gap-2">
            {estado !== "conectada" && (
              <Button size="sm" disabled={iniciar.isPending} onClick={() => iniciar.mutate()}>
                {iniciar.isPending
                  ? "Preparando…"
                  : estado === "conectando"
                    ? "Gerar novo QR code"
                    : "Conectar WhatsApp"}
              </Button>
            )}
            {estado !== "desconectada" && (
              <Button
                size="sm"
                variant="outline"
                disabled={sair.isPending}
                onClick={() => sair.mutate()}
              >
                Desconectar
              </Button>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Só administrador ou gestor conecta o WhatsApp.
          </p>
        )}
      </div>

      <div className="panel mb-6 max-w-2xl space-y-3 p-4">
        <h2 className="text-sm font-semibold">Envio automático</h2>
        <p className="text-xs text-muted-foreground">
          Envia sozinho entre 8h e 20h, com uma pausa entre as mensagens. Tutor que não aceita
          mensagens ou que responde SAIR não recebe. A vacina já agendada não gera lembrete, e o
          lembrete enviado tira o pet da lista manual de reforços.
        </p>
        {[
          {
            chave: "reforco" as const,
            titulo: `Vacina ou vermífugo (${dias.reforcoAntes} dia(s) antes até ${dias.reforcoAtraso} de atraso)`,
            valor: config?.auto_reforco ?? false,
          },
          {
            chave: "retorno" as const,
            titulo: `Retorno de consulta (do dia até ${dias.retornoAntes} dia(s) antes)`,
            valor: config?.auto_retorno ?? false,
          },
        ].map((o) => (
          <div key={o.chave} className="flex items-center gap-3">
            <Switch
              id={`auto-${o.chave}`}
              checked={o.valor}
              disabled={!podeRegras || estado !== "conectada" || automatico.isPending}
              onCheckedChange={(v) =>
                automatico.mutate({
                  reforco: o.chave === "reforco" ? v : (config?.auto_reforco ?? false),
                  retorno: o.chave === "retorno" ? v : (config?.auto_retorno ?? false),
                })
              }
            />
            <Label htmlFor={`auto-${o.chave}`}>{o.titulo}</Label>
          </div>
        ))}
        <div className="space-y-2 rounded border p-3">
          <h3 className="text-xs font-semibold">Regras de envio</h3>
          <div className="grid items-end gap-3 sm:grid-cols-3">
            {[
              { k: "reforcoAntes" as const, l: "Vacina: dias antes", max: 30 },
              { k: "reforcoAtraso" as const, l: "Vacina: dias após vencer", max: 60 },
              { k: "retornoAntes" as const, l: "Retorno: dias antes", max: 30 },
            ].map((f) => (
              <div key={f.k} className="space-y-1">
                <Label htmlFor={`dias-${f.k}`} className="block truncate text-xs">
                  {f.l}
                </Label>
                <Input
                  id={`dias-${f.k}`}
                  type="number"
                  min={0}
                  max={f.max}
                  value={dias[f.k]}
                  disabled={!podeRegras}
                  onChange={(e) =>
                    setDias((d) => ({
                      ...d,
                      [f.k]: Math.max(0, Math.min(f.max, Math.trunc(Number(e.target.value) || 0))),
                    }))
                  }
                />
              </div>
            ))}
          </div>
          {podeRegras ? (
            <Button
              size="sm"
              disabled={estado !== "conectada" || automatico.isPending}
              onClick={() =>
                automatico.mutate({
                  reforco: config?.auto_reforco ?? false,
                  retorno: config?.auto_retorno ?? false,
                  aviso: true,
                })
              }
            >
              Salvar regras
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Só veterinário, administrador ou gestor altera as regras.
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          O texto do lembrete de vacina é o modelo da lista de reforços (Clínica › Reforços de
          vacina). O do retorno:
        </p>
        <ModeloMensagem
          tipo="retorno_clinica"
          id="wa-modelo-retorno"
          valor={modeloRetorno}
          onChange={setModeloRetorno}
        />
      </div>

      <PainelRelacionamentoClinica />

      <h2 className="mb-2 text-sm font-semibold">Últimos lembretes</h2>
      {mensagens.length === 0 ? (
        <EmptyState
          title="Nenhum lembrete ainda"
          description="Os lembretes enviados pelo sistema aparecem aqui, com a situação de cada um."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Tutor / pet</TableHead>
                <TableHead>Lembrete</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mensagens.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{dateTimeBR(m.enviada_em ?? m.created_at)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{m.variaveis.cliente ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[m.variaveis.pet, m.variaveis.itens].filter(Boolean).join(" · ")}
                    </div>
                  </TableCell>
                  <TableCell>
                    {ROTULO_AVISO_CLINICA[m.tipo as keyof typeof ROTULO_AVISO_CLINICA] ?? m.tipo}
                    {m.origem === "automatico" ? " · automático" : ""}
                  </TableCell>
                  <TableCell>
                    {rotuloEvidencia(m.situacao)}
                    {m.erro ? <div className="text-xs text-destructive">{m.erro}</div> : null}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {m.situacao === "na_fila" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={acao.isPending}
                        onClick={() =>
                          acao.mutate({ id: m.id, qual: "clinica_wa_mensagem_cancelar" })
                        }
                      >
                        Cancelar
                      </Button>
                    )}
                    {(m.situacao === "falhou" || m.situacao === "cancelada") && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={acao.isPending || estado !== "conectada"}
                        onClick={() =>
                          acao.mutate({ id: m.id, qual: "clinica_wa_mensagem_reenviar" })
                        }
                      >
                        Reenviar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
