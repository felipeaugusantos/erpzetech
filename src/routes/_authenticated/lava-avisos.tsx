import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Phone, Send } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
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
import { Textarea } from "@/components/ui/textarea";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { linkWhatsApp, telefoneWhatsApp } from "@/lib/contato-pet";
import { dateBR } from "@/lib/format";
import {
  AVISOS,
  CAMPOS_AVISO,
  MENSAGEM_LAVA_PADRAO,
  formatarIdentificacao,
  montarMensagemLava,
  type TipoAviso,
} from "@/lib/lava-rapido";

export const Route = createFileRoute("/_authenticated/lava-avisos")({
  head: () => ({
    meta: [
      { title: "Avisos ao cliente do lava rápido — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Veículo pronto, plano vencendo e retorno do cliente, com a mensagem de WhatsApp pronta para a recepção.",
      },
    ],
  }),
  component: AvisosModulo,
});

type Pendente = {
  referencia: string;
  cliente: string;
  veiculo: string;
  tipo_veiculo: string;
  telefone: string | null;
  data: string;
  plano?: string;
  restam?: number;
  dias?: number;
};

function AvisosModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.lavarapido) return <ModuloBloqueado modulo="lavarapido" />;
  return <Avisos />;
}

function Avisos() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const podeEditarModelo = (session?.roles ?? []).some((r) =>
    ["administrador", "gestor"].includes(r),
  );
  const loja = session?.empresa?.nome_fantasia || session?.empresa?.razao_social || "nossa loja";
  const [tipo, setTipo] = useState<TipoAviso>("pronto");
  const [janela, setJanela] = useState("7");
  const [modelo, setModelo] = useState(MENSAGEM_LAVA_PADRAO.pronto);

  const janelaN = Number(janela);
  const usaJanela = tipo !== "pronto";
  const minimo = tipo === "retorno" ? 7 : 0;
  const maximo = tipo === "retorno" ? 365 : 60;
  const valido =
    !usaJanela || (Number.isInteger(janelaN) && janelaN >= minimo && janelaN <= maximo);

  // modelo guardado pela empresa (sem linha, vale o texto padrão do sistema)
  const { data: salvos } = useQuery({
    queryKey: ["lava-modelos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lr_mensagem_modelos").select("tipo, texto");
      if (error) throw error;
      return data ?? [];
    },
  });
  const salvo = salvos?.find((m) => m.tipo === tipo)?.texto;
  useEffect(() => {
    setModelo(salvo ?? MENSAGEM_LAVA_PADRAO[tipo]);
  }, [tipo, salvo]);

  function trocarTipo(t: TipoAviso) {
    setTipo(t);
    setJanela(t === "retorno" ? "30" : "7");
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ["lava-avisos", tipo, usaJanela ? janelaN : 0],
    enabled: valido,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("lr_mensagens_pendentes", {
        p_tipo: tipo,
        ...(usaJanela ? { p_janela: janelaN } : {}),
      });
      if (error) throw error;
      return (data ?? []) as unknown as Pendente[];
    },
  });

  // WhatsApp conectado pelo sistema: aparece o envio direto, e quem já está na fila não é enviado de novo
  const { data: wa } = useQuery({
    queryKey: ["wa-config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("wa_config").select("estado").maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const sistemaConectado = wa?.estado === "conectada";
  const { data: naFila } = useQuery({
    queryKey: ["wa-fila", tipo],
    enabled: sistemaConectado,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_mensagens")
        .select("referencia")
        .eq("tipo", tipo)
        .in("situacao", ["na_fila", "enviando"]);
      if (error) throw error;
      return new Set((data ?? []).map((m) => m.referencia));
    },
  });

  const enviarPeloSistema = useMutation({
    mutationFn: async (l: Pendente) => {
      const { error } = await supabase.rpc("wa_enfileirar", {
        p_tipo: tipo,
        p_referencia: l.referencia,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Na fila: o sistema envia em até 1 minuto.");
      void qc.invalidateQueries({ queryKey: ["wa-fila"] });
      void qc.invalidateQueries({ queryKey: ["wa-mensagens"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const registrar = useMutation({
    mutationFn: async (p: { l: Pendente; canal: "whatsapp" | "telefone" | "outro" }) => {
      const { error } = await supabase.rpc("lr_contato_registrar", {
        p_tipo: tipo,
        p_referencia: p.l.referencia,
        p_canal: p.canal,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["lava-avisos"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarModelo = useMutation({
    mutationFn: async (texto: string) => {
      const { error } = await supabase.rpc("lr_mensagem_modelo_salvar", {
        p_tipo: tipo,
        p_texto: texto,
      });
      if (error) throw error;
    },
    onSuccess: (_r, texto) => {
      toast.success(texto.trim() ? "Mensagem da loja salva." : "Voltou ao texto padrão.");
      void qc.invalidateQueries({ queryKey: ["lava-modelos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mensagem = (l: Pendente) =>
    montarMensagemLava(modelo, {
      cliente: l.cliente,
      veiculo: formatarIdentificacao(l.tipo_veiculo, l.veiculo),
      loja,
      data: dateBR(l.data),
      ...(l.plano ? { plano: l.plano } : {}),
      ...(l.restam !== undefined ? { restam: l.restam } : {}),
      ...(l.dias !== undefined ? { dias: l.dias } : {}),
    });

  function chamar(l: Pendente) {
    const link = linkWhatsApp(l.telefone, mensagem(l));
    if (!link) {
      toast.error("Este cliente não tem um telefone válido para o WhatsApp.");
      return;
    }
    window.open(link, "_blank", "noopener");
    registrar.mutate({ l, canal: "whatsapp" });
  }

  const info = AVISOS.find((a) => a.value === tipo)!;
  const lista = data ?? [];

  return (
    <div>
      <PageHeader
        title="Avisos ao cliente"
        description="Veículo pronto, plano vencendo e retorno do cliente. A recepção chama pelo WhatsApp com a mensagem já pronta; quem já foi chamado sai da lista, e cliente que não quer mensagens não aparece."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Label htmlFor="av-tipo">Aviso</Label>
          <Select value={tipo} onValueChange={(v) => trocarTipo(v as TipoAviso)}>
            <SelectTrigger id="av-tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AVISOS.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {usaJanela && (
          <div className="w-44">
            <Label htmlFor="av-janela">
              {tipo === "retorno" ? "Sem voltar há (dias)" : "Vence nos próximos (dias)"}
            </Label>
            <Input
              id="av-janela"
              inputMode="numeric"
              value={janela}
              onChange={(e) => setJanela(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="panel mb-6 max-w-2xl space-y-2 p-4">
        <Label htmlFor="av-modelo">Mensagem</Label>
        <Textarea
          id="av-modelo"
          rows={3}
          value={modelo}
          onChange={(e) => setModelo(e.target.value)}
        />
        {sistemaConectado && (
          <p className="text-xs text-muted-foreground">
            O envio pelo sistema usa a mensagem salva da loja (ou o texto padrão), com o aviso para
            responder SAIR.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Campos:{" "}
          {["cliente", "veiculo", "loja", ...CAMPOS_AVISO[tipo]].map((c) => `{${c}}`).join(" ")}
        </p>
        {podeEditarModelo && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={salvarModelo.isPending}
              onClick={() => salvarModelo.mutate(modelo)}
            >
              Salvar como mensagem da loja
            </Button>
            {salvo && (
              <Button
                size="sm"
                variant="ghost"
                disabled={salvarModelo.isPending}
                onClick={() => salvarModelo.mutate("")}
              >
                Voltar ao texto padrão
              </Button>
            )}
          </div>
        )}
      </div>

      {!valido ? (
        <p className="text-sm text-destructive">
          Informe um número de dias entre {minimo} e {maximo}.
        </p>
      ) : error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : lista.length === 0 ? (
        <EmptyState
          title="Ninguém para chamar agora"
          description="Quando houver, a lista aparece aqui. Quem já foi chamado não volta."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Veículo</TableHead>
                <TableHead>{info.coluna}</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((l) => (
                <TableRow key={l.referencia}>
                  <TableCell className="font-medium">{l.cliente}</TableCell>
                  <TableCell>
                    {formatarIdentificacao(l.tipo_veiculo, l.veiculo)}
                    {l.plano ? ` · ${l.plano}` : ""}
                  </TableCell>
                  <TableCell>
                    {dateBR(l.data)}
                    {l.dias !== undefined ? ` · ${l.dias} dias` : ""}
                    {l.restam !== undefined ? ` · restam ${l.restam}` : ""}
                  </TableCell>
                  <TableCell>{l.telefone ?? "—"}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    {sistemaConectado &&
                      (naFila?.has(l.referencia) ? (
                        <span className="text-xs text-muted-foreground">Na fila de envio</span>
                      ) : (
                        <Button
                          size="sm"
                          disabled={!telefoneWhatsApp(l.telefone) || enviarPeloSistema.isPending}
                          onClick={() => enviarPeloSistema.mutate(l)}
                        >
                          <Send className="size-4" /> Enviar pelo sistema
                        </Button>
                      ))}
                    <Button
                      size="sm"
                      variant={sistemaConectado ? "outline" : "default"}
                      disabled={!telefoneWhatsApp(l.telefone) || registrar.isPending}
                      onClick={() => chamar(l)}
                    >
                      <MessageCircle className="size-4" /> WhatsApp
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={registrar.isPending}
                      onClick={() => registrar.mutate({ l, canal: "telefone" })}
                    >
                      <Phone className="size-4" /> Já falei
                    </Button>
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
