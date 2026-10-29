import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
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
import { dateTimeBR } from "@/lib/format";
import { AVISOS, formatarIdentificacao } from "@/lib/lava-rapido";
import {
  whatsappAtualizar,
  whatsappConectar,
  whatsappDesconectar,
  type ResultadoConexao,
} from "@/lib/whatsapp.functions";
import { rotuloSituacao } from "@/lib/whatsapp-despacho";

export const Route = createFileRoute("/_authenticated/lava-whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp automático — EZRA ERP" },
      {
        name: "description",
        content:
          "Conecte o WhatsApp da loja e envie os avisos ao cliente do lava rápido pelo sistema.",
      },
    ],
  }),
  component: WhatsAppModulo,
});

function WhatsAppModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.lavarapido) return <ModuloBloqueado modulo="lavarapido" />;
  return <WhatsApp />;
}

type Config = {
  estado: "conectada" | "desconectada" | "conectando";
  numero: string | null;
  auto_pronto: boolean;
  auto_plano: boolean;
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
  variaveis: { cliente?: string; veiculo?: string; tipo_veiculo?: string };
};

function WhatsApp() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const gestor = (session?.roles ?? []).some((r) => ["administrador", "gestor"].includes(r));
  const conectar = useServerFn(whatsappConectar);
  const atualizar = useServerFn(whatsappAtualizar);
  const desconectar = useServerFn(whatsappDesconectar);
  const [conexao, setConexao] = useState<ResultadoConexao | null>(null);

  const { data: config, isLoading } = useQuery({
    queryKey: ["wa-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_config")
        .select("estado, numero, auto_pronto, auto_plano")
        .maybeSingle();
      if (error) throw error;
      return (data as Config | null) ?? null;
    },
  });
  const estado = conexao?.estado ?? config?.estado ?? "desconectada";

  const { data: mensagens = [] } = useQuery({
    queryKey: ["wa-mensagens"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_mensagens")
        .select(
          "id, tipo, situacao, origem, erro, tentativas, created_at, enviada_em, numero, variaveis",
        )
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as unknown as Linha[];
    },
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["wa-config"] });
    void qc.invalidateQueries({ queryKey: ["wa-mensagens"] });
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

  const automatico = useMutation({
    mutationFn: async (p: { pronto: boolean; plano: boolean }) => {
      const { error } = await supabase.rpc("wa_automatico_salvar", {
        p_pronto: p.pronto,
        p_plano: p.plano,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const acao = useMutation({
    mutationFn: async (p: {
      id: string;
      qual: "wa_mensagem_cancelar" | "wa_mensagem_reenviar";
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
        title="WhatsApp automático"
        description="Conecte o WhatsApp da loja para enviar os avisos do lava rápido pelo sistema. Use um número só da loja: a conexão é pelo WhatsApp Web, não oficial, e o WhatsApp pode restringir números que enviam em excesso."
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
              No celular da loja: WhatsApp › Aparelhos conectados › Conectar um aparelho, e leia
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
          Envia sozinho entre 8h e 20h, com uma pausa entre as mensagens. Cliente que não aceita
          mensagens ou que responde SAIR não recebe. Retorno de cliente continua manual, em Avisos
          ao cliente.
        </p>
        {[
          {
            chave: "pronto" as const,
            titulo: "Veículo pronto para retirar",
            valor: config?.auto_pronto ?? false,
          },
          {
            chave: "plano" as const,
            titulo: "Plano vencendo em até 3 dias",
            valor: config?.auto_plano ?? false,
          },
        ].map((o) => (
          <div key={o.chave} className="flex items-center gap-3">
            <Switch
              id={`auto-${o.chave}`}
              checked={o.valor}
              disabled={!gestor || estado !== "conectada" || automatico.isPending}
              onCheckedChange={(v) =>
                automatico.mutate({
                  pronto: o.chave === "pronto" ? v : (config?.auto_pronto ?? false),
                  plano: o.chave === "plano" ? v : (config?.auto_plano ?? false),
                })
              }
            />
            <Label htmlFor={`auto-${o.chave}`}>{o.titulo}</Label>
          </div>
        ))}
      </div>

      <h2 className="mb-2 text-sm font-semibold">Últimas mensagens</h2>
      {mensagens.length === 0 ? (
        <EmptyState
          title="Nenhuma mensagem ainda"
          description="As mensagens enviadas pelo sistema aparecem aqui, com a situação de cada uma."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Aviso</TableHead>
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
                      {m.variaveis.veiculo
                        ? formatarIdentificacao(
                            m.variaveis.tipo_veiculo ?? "carro",
                            m.variaveis.veiculo,
                          )
                        : ""}
                    </div>
                  </TableCell>
                  <TableCell>
                    {AVISOS.find((a) => a.value === m.tipo)?.label ?? m.tipo}
                    {m.origem === "automatico" ? " · automático" : ""}
                  </TableCell>
                  <TableCell>
                    {rotuloSituacao(m.situacao)}
                    {m.erro ? <div className="text-xs text-destructive">{m.erro}</div> : null}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {m.situacao === "na_fila" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={acao.isPending}
                        onClick={() => acao.mutate({ id: m.id, qual: "wa_mensagem_cancelar" })}
                      >
                        Cancelar
                      </Button>
                    )}
                    {(m.situacao === "falhou" || m.situacao === "cancelada") && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={acao.isPending || estado !== "conectada"}
                        onClick={() => acao.mutate({ id: m.id, qual: "wa_mensagem_reenviar" })}
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
