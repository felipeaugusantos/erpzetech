import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Phone, Send } from "lucide-react";
import { toast } from "sonner";

import { ModeloMensagem } from "@/components/app/ModeloMensagem";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
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
import {
  MENSAGEM_REFORCO,
  linkWhatsApp,
  listaEmTexto,
  montarMensagem,
  telefoneWhatsApp,
} from "@/lib/contato-pet";
import { dateBR } from "@/lib/format";
import { estadoDoAviso } from "@/lib/relacionamento-clinica";

export const Route = createFileRoute("/_authenticated/clinica-reforcos")({
  head: () => ({
    meta: [
      { title: "Reforços de vacina — EZRA ERP" },
      {
        name: "description",
        content:
          "Pets com vacina ou vermífugo para tomar ou atrasado, com a mensagem de WhatsApp pronta para a recepção.",
      },
    ],
  }),
  component: ReforcosModulo,
});

type Linha = {
  pet_id: string;
  pet: string;
  especie: string;
  tutor: string;
  telefone: string | null;
  referencia: string;
  dias: number;
  itens: { nome: string; tipo: string }[];
};

function ReforcosModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Reforcos />;
}

function Reforcos() {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const loja = sessao?.empresa?.nome_fantasia || sessao?.empresa?.razao_social || "nossa clínica";
  const [janela, setJanela] = useState("15");
  const [atraso, setAtraso] = useState("180");
  const [modelo, setModelo] = useState(MENSAGEM_REFORCO);
  /** Canal gravado pelo botão "Já falei". Abrir o WhatsApp não grava contato: só "Já falei" (ou a entrega confirmada) tira o pet da lista. */
  const [canalJaFalei, setCanalJaFalei] = useState<"telefone" | "whatsapp" | "outro">("telefone");

  const janelaN = Number(janela);
  const atrasoN = Number(atraso);
  const valido =
    Number.isInteger(janelaN) &&
    janelaN >= 0 &&
    janelaN <= 60 &&
    Number.isInteger(atrasoN) &&
    atrasoN >= 0 &&
    atrasoN <= 730;

  const { data, isLoading, error } = useQuery({
    queryKey: ["clinica-reforcos", janelaN, atrasoN],
    enabled: valido,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_reforcos_pendentes", {
        p_janela: janelaN,
        p_atraso: atrasoN,
      });
      if (error) throw error;
      return (data ?? []) as unknown as Linha[];
    },
  });

  const { data: wa } = useQuery({
    queryKey: ["clinica-wa-config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("wa_config").select("estado").maybeSingle();
      if (error) throw error;
      return data as { estado: string } | null;
    },
  });
  const waConectada = wa?.estado === "conectada";

  // aviso do sistema já existente por ocasião (pet + data): evita novo envio em duplicidade e mostra em que pé está
  const { data: avisos } = useQuery({
    queryKey: ["clinica-reforcos-avisos"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const desde = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("wa_mensagens")
        .select("referencia, situacao, erro, enviada_em")
        .eq("tipo", "reforco_vacina")
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const mapa = new Map<
        string,
        { situacao: string; erro: string | null; enviada_em: string | null }
      >();
      for (const m of (data ?? []) as {
        referencia: string;
        situacao: string;
        erro: string | null;
        enviada_em: string | null;
      }[]) {
        const chave = m.referencia.toLowerCase();
        if (!mapa.has(chave)) mapa.set(chave, m);
      }
      return mapa;
    },
  });

  const enfileirar = useMutation({
    mutationFn: async (l: Linha) => {
      const { error } = await supabase.rpc("clinica_wa_enfileirar", {
        p_tipo: "reforco_vacina",
        p_referencia: `${l.pet_id}:${l.referencia}`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["clinica-reforcos-avisos"] });
      toast.success("Lembrete na fila", {
        description: "O sistema envia pelo WhatsApp da empresa em instantes.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível enfileirar", { description: e.message }),
  });

  const registrar = useMutation({
    mutationFn: async (p: { l: Linha; canal: "whatsapp" | "telefone" | "outro" }) => {
      const { error } = await supabase.rpc("pet_contato_registrar", {
        p_pet_id: p.l.pet_id,
        p_tipo: "reforco",
        p_referencia: p.l.referencia,
        p_canal: p.canal,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["clinica-reforcos"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const mensagem = (l: Linha) =>
    montarMensagem(modelo, {
      tutor: l.tutor,
      pet: l.pet,
      loja,
      data: dateBR(l.referencia),
      itens: listaEmTexto(l.itens.map((i) => i.nome)),
    });

  function chamar(l: Linha) {
    const link = linkWhatsApp(l.telefone, mensagem(l));
    if (!link) {
      toast.error("Este tutor não tem um telefone válido para o WhatsApp.");
      return;
    }
    window.open(link, "_blank", "noopener");
    toast.info("WhatsApp aberto", {
      description: "Depois de enviar a mensagem, clique em “Já falei” para tirar o pet da lista.",
    });
  }

  const lista = data ?? [];

  return (
    <div>
      <PageHeader
        title="Reforços de vacina e vermífugo"
        description="Pets com dose para tomar nos próximos dias ou já atrasada. O pet sai da lista quando a recepção marca “Já falei” ou quando o WhatsApp confirma a entrega do aviso enviado pelo sistema. Abrir o WhatsApp não conta como contato. Mostra só o nome da vacina e a data."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Label htmlFor="rf-janela">Próximos (dias)</Label>
          <Input
            id="rf-janela"
            inputMode="numeric"
            value={janela}
            onChange={(e) => setJanela(e.target.value)}
          />
        </div>
        <div className="w-48">
          <Label htmlFor="rf-atraso">Atrasados até (dias)</Label>
          <Input
            id="rf-atraso"
            inputMode="numeric"
            value={atraso}
            onChange={(e) => setAtraso(e.target.value)}
          />
        </div>
        <div className="w-64">
          <Label htmlFor="rf-canal">Quando clicar em &quot;Já falei&quot;, foi por</Label>
          <Select
            value={canalJaFalei}
            onValueChange={(v) => setCanalJaFalei(v as typeof canalJaFalei)}
          >
            <SelectTrigger id="rf-canal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="telefone">Telefone</SelectItem>
              <SelectItem value="whatsapp">WhatsApp (enviei a mensagem)</SelectItem>
              <SelectItem value="outro">Pessoalmente / outro</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {!valido && (
        <p className="mb-3 text-sm text-destructive">
          Informe de 0 a 60 dias à frente e de 0 a 730 de atraso.
        </p>
      )}

      <ModeloMensagem tipo="reforco" id="rf-modelo" valor={modelo} onChange={setModelo} />

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : error ? (
        <EmptyState title="Não foi possível carregar" description={(error as Error).message} />
      ) : lista.length === 0 ? (
        <EmptyState title="Ninguém para chamar agora" description="Tudo em dia nesta lista." />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pet</TableHead>
                <TableHead>Tutor</TableHead>
                <TableHead>Dose</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((l) => {
                const a = avisos?.get(`${l.pet_id}:${l.referencia}`.toLowerCase());
                const aviso = estadoDoAviso(a?.situacao, a?.enviada_em, a?.erro);
                return (
                  <TableRow key={`${l.pet_id}-${l.referencia}`}>
                    <TableCell className="font-medium">{l.pet}</TableCell>
                    <TableCell>
                      {l.tutor}
                      <span className="block text-xs text-muted-foreground">
                        {l.telefone ?? "sem telefone"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {l.itens.map((i) => i.nome).join(", ")}
                      <span className="block text-xs text-muted-foreground">
                        {dateBR(l.referencia)}{" "}
                        {l.dias < 0 ? (
                          <Badge variant="destructive">atrasada há {-l.dias} dia(s)</Badge>
                        ) : l.dias === 0 ? (
                          <Badge variant="secondary">hoje</Badge>
                        ) : (
                          `(em ${l.dias} dia(s))`
                        )}
                      </span>
                      {aviso.rotulo && (
                        <span
                          className={
                            aviso.tom === "alerta"
                              ? "mt-1 block text-xs text-destructive"
                              : "mt-1 block text-xs text-muted-foreground"
                          }
                        >
                          {aviso.rotulo}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label="Enviar pelo sistema"
                          title={
                            waConectada
                              ? "O sistema envia pelo WhatsApp da empresa"
                              : "Conecte o WhatsApp da empresa em Clínica > WhatsApp da clínica"
                          }
                          disabled={!waConectada || enfileirar.isPending || aviso.bloqueiaNovoEnvio}
                          onClick={() => enfileirar.mutate(l)}
                        >
                          <Send className="size-4" />
                          <span className="hidden sm:inline">Enviar pelo sistema</span>
                        </Button>
                        <Button
                          size="sm"
                          aria-label="Abrir WhatsApp"
                          title="Abre o WhatsApp com a mensagem pronta; não registra contato"
                          disabled={!telefoneWhatsApp(l.telefone) || aviso.bloqueiaNovoEnvio}
                          onClick={() => chamar(l)}
                        >
                          <MessageCircle className="size-4" />
                          <span className="hidden sm:inline">Abrir WhatsApp</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label="Já falei"
                          disabled={registrar.isPending}
                          onClick={() => registrar.mutate({ l, canal: canalJaFalei })}
                        >
                          <Phone className="size-4" />
                          <span className="hidden sm:inline">Já falei</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
