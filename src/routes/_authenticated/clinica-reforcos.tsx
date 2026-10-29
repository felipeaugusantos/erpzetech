import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Phone } from "lucide-react";
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
  /** Canal gravado pelo botão "Já falei" (o botão do WhatsApp sempre grava "whatsapp"). */
  const [canalJaFalei, setCanalJaFalei] = useState<"telefone" | "outro">("telefone");

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
    registrar.mutate({ l, canal: "whatsapp" });
  }

  const lista = data ?? [];

  return (
    <div>
      <PageHeader
        title="Reforços de vacina e vermífugo"
        description="Pets com dose para tomar nos próximos dias ou já atrasada. O contato é feito pela recepção (sem envio automático); quem já foi chamado sai da lista. Mostra só o nome da vacina e a data."
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
