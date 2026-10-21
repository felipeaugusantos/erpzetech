import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";

import { ModeloMensagem } from "@/components/app/ModeloMensagem";
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
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import {
  MENSAGEM_PADRAO,
  linkWhatsApp,
  montarMensagem,
  telefoneWhatsApp,
  type TipoContato,
} from "@/lib/contato-pet";
import { dateBR } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/pet-contatos")({
  head: () => ({
    meta: [
      { title: "Contatos do pet shop — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Aniversário dos pets e retorno de banho, com a mensagem de WhatsApp pronta para a recepção.",
      },
    ],
  }),
  component: ContatosModulo,
});

type Pendente = {
  pet_id: string;
  pet: string;
  tutor: string;
  telefone: string | null;
  referencia: string;
  anos?: number;
  dias?: number;
  hora?: string;
  servicos?: string | null;
};

const ROTULOS: Record<TipoContato, { lista: string; coluna: string }> = {
  retorno: { lista: "Retorno de banho", coluna: "Último banho" },
  aniversario: { lista: "Aniversário do pet", coluna: "Aniversário" },
  confirmacao: { lista: "Confirmar agendamento", coluna: "Agendado para" },
  pronto: { lista: "Pet pronto para retirar", coluna: "Atendimento" },
  exame: { lista: "Exame pronto", coluna: "Exame fechado em" },
};
const USA_RPC_ANTIGA = (t: TipoContato) => t === "retorno" || t === "aniversario";

function ContatosModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.petshop) return <ModuloBloqueado modulo="petshop" />;
  return <Contatos />;
}

function Contatos() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const loja =
    session?.empresa?.nome_fantasia || session?.empresa?.razao_social || "nosso pet shop";
  const [tipo, setTipo] = useState<TipoContato>("retorno");
  const [dias, setDias] = useState("30");
  const [janela, setJanela] = useState("7");
  const [modelo, setModelo] = useState(MENSAGEM_PADRAO.retorno);
  /** Canal gravado pelo botão "Já falei" (o botão do WhatsApp sempre grava "whatsapp"). */
  const [canalJaFalei, setCanalJaFalei] = useState<"telefone" | "outro">("telefone");

  function trocarTipo(t: TipoContato) {
    setTipo(t);
    setModelo(MENSAGEM_PADRAO[t]);
    setJanela(t === "confirmacao" ? "1" : t === "exame" ? "7" : "7");
  }

  const diasN = Number(dias);
  const janelaN = Number(janela);
  const limiteJanela = tipo === "aniversario" ? 60 : 30;
  const valido =
    tipo === "retorno"
      ? Number.isInteger(diasN) && diasN >= 7 && diasN <= 365
      : tipo === "pronto" || (Number.isInteger(janelaN) && janelaN >= 0 && janelaN <= limiteJanela);

  const { data, isLoading, error } = useQuery({
    queryKey: ["pet-contatos", tipo, diasN, janelaN],
    enabled: valido,
    queryFn: async () => {
      const { data, error } = USA_RPC_ANTIGA(tipo)
        ? await supabase.rpc("pet_contatos_pendentes", {
            p_tipo: tipo,
            ...(tipo === "retorno" ? { p_dias: diasN } : { p_janela: janelaN }),
          })
        : await supabase.rpc("pet_mensagens_pendentes", {
            p_tipo: tipo,
            p_janela: tipo === "pronto" ? 1 : janelaN,
          });
      if (error) throw error;
      return (data ?? []) as unknown as Pendente[];
    },
  });

  const registrar = useMutation({
    mutationFn: async (p: { l: Pendente; canal: "whatsapp" | "telefone" | "outro" }) => {
      const { error } = await supabase.rpc("pet_contato_registrar", {
        p_pet_id: p.l.pet_id,
        p_tipo: tipo,
        p_referencia: p.l.referencia,
        p_canal: p.canal,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pet-contatos"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const mensagem = (l: Pendente) =>
    montarMensagem(modelo, {
      tutor: l.tutor,
      pet: l.pet,
      loja,
      data: dateBR(l.referencia),
      ...(l.dias !== undefined ? { dias: l.dias } : {}),
      ...(l.hora ? { hora: l.hora } : {}),
      ...(l.servicos ? { servicos: l.servicos.toLowerCase() } : {}),
    });

  function chamar(l: Pendente) {
    const link = linkWhatsApp(l.telefone, mensagem(l));
    if (!link) {
      toast.error("Este tutor não tem um telefone válido para o WhatsApp.");
      return;
    }
    window.open(link, "_blank", "noopener");
    registrar.mutate({ l, canal: "whatsapp" });
  }

  const lista = data ?? [];

  return (
    <div>
      <PageHeader
        title="Contatos do pet shop"
        description="Quem vale chamar hoje: aniversário, retorno de banho, confirmação de agendamento, pet pronto e exame pronto. O contato é feito pela recepção, com a mensagem de WhatsApp já pronta; quem já foi chamado sai da lista, e tutor que não quer mensagens não aparece."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Label htmlFor="ct-tipo">Lista</Label>
          <Select value={tipo} onValueChange={(v) => trocarTipo(v as TipoContato)}>
            <SelectTrigger id="ct-tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROTULOS) as TipoContato[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {ROTULOS[t].lista}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {tipo === "retorno" ? (
          <div className="w-44">
            <Label htmlFor="ct-dias">Sem vir há (dias)</Label>
            <Input
              id="ct-dias"
              inputMode="numeric"
              value={dias}
              onChange={(e) => setDias(e.target.value)}
            />
          </div>
        ) : tipo === "pronto" ? null : (
          <div className="w-44">
            <Label htmlFor="ct-janela">
              {tipo === "exame" ? "Fechados nos últimos (dias)" : "Próximos (dias)"}
            </Label>
            <Input
              id="ct-janela"
              inputMode="numeric"
              value={janela}
              onChange={(e) => setJanela(e.target.value)}
            />
          </div>
        )}
      </div>
      <div className="mb-4 w-64">
        <Label htmlFor="ct-canal">Quando clicar em &quot;Já falei&quot;, foi por</Label>
        <Select
          value={canalJaFalei}
          onValueChange={(v) => setCanalJaFalei(v as typeof canalJaFalei)}
        >
          <SelectTrigger id="ct-canal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="telefone">Telefone</SelectItem>
            <SelectItem value="outro">Pessoalmente / outro</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!valido && (
        <p className="mb-3 text-sm text-destructive">
          {tipo === "retorno" ? "Informe de 7 a 365 dias." : `Informe de 0 a ${limiteJanela} dias.`}
        </p>
      )}

      <ModeloMensagem tipo={tipo} id="ct-modelo" valor={modelo} onChange={setModelo} />

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
                <TableHead>{ROTULOS[tipo].coluna}</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((l) => (
                <TableRow key={`${l.pet_id}-${l.referencia}`}>
                  <TableCell className="font-medium">{l.pet}</TableCell>
                  <TableCell>
                    {l.tutor}
                    <span className="block text-xs text-muted-foreground">
                      {l.telefone ?? "sem telefone"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {dateBR(l.referencia)}{" "}
                    <span className="text-xs text-muted-foreground">
                      {tipo === "retorno"
                        ? `(há ${l.dias} dias)`
                        : tipo === "confirmacao"
                          ? `às ${l.hora ?? ""}${l.servicos ? ` — ${l.servicos}` : ""}`
                          : l.anos
                            ? `(${l.anos} ${l.anos === 1 ? "ano" : "anos"})`
                            : ""}
                    </span>
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button
                      size="sm"
                      disabled={!telefoneWhatsApp(l.telefone) || registrar.isPending}
                      onClick={() => chamar(l)}
                    >
                      <MessageCircle className="size-4" /> WhatsApp
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={registrar.isPending}
                      onClick={() => registrar.mutate({ l, canal: canalJaFalei })}
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
