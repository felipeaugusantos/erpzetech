/* eslint-disable @typescript-eslint/no-explicit-any -- nfe_eventos ainda não está nos tipos gerados do banco */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Ban, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { consultarEventoNfe, inutilizarNumeracaoNfe } from "@/lib/nfe-fiscal.functions";
import { MAX_FAIXA_INUTILIZACAO, normalizarTexto } from "@/lib/nfe-eventos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Evento = {
  id: string;
  serie: number;
  numero_inicial: number;
  numero_final: number;
  situacao: string;
  protocolo: string | null;
  mensagem: string | null;
  criado_em: string;
};

const SITUACAO: Record<string, string> = {
  registrado: "Registrada na Receita",
  pendente: "Em processamento",
  rejeitado: "Recusada",
  erro: "Falhou",
};

export function InutilizarNumeracao() {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [serie, setSerie] = useState("1");
  const [inicial, setInicial] = useState("");
  const [final, setFinal] = useState("");
  const [justificativa, setJustificativa] = useState("");

  const inutilizar = useServerFn(inutilizarNumeracaoNfe);
  const consultar = useServerFn(consultarEventoNfe);

  const { data: historico } = useQuery({
    queryKey: ["nfe-inutilizacoes"],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nfe_eventos")
        .select("id, serie, numero_inicial, numero_final, situacao, protocolo, mensagem, criado_em")
        .eq("tipo", "inutilizacao")
        .order("criado_em", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Evento[];
    },
  });

  const enviar = useMutation({
    mutationFn: async () =>
      inutilizar({
        data: {
          serie: Number(serie),
          numeroInicial: Number(inicial),
          numeroFinal: Number(final || inicial),
          justificativa,
        },
      }),
    onSuccess: async (r: { ok: boolean; situacao: string; mensagem: string | null }) => {
      if (r.ok) {
        toast.success("Numeração inutilizada na Receita");
        setInicial("");
        setFinal("");
        setJustificativa("");
      } else if (r.situacao === "pendente") {
        toast.info("Pedido enviado; a Receita ainda está processando.");
      } else {
        toast.error(r.mensagem || "A Receita recusou a inutilização.");
      }
      await qc.invalidateQueries({ queryKey: ["nfe-inutilizacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const atualizar = useMutation({
    mutationFn: async (eventoId: string) => consultar({ data: { eventoId } }),
    onSuccess: async (r: { situacao: string }) => {
      toast.info(`Situação na Receita: ${SITUACAO[r.situacao] ?? r.situacao}`);
      await qc.invalidateQueries({ queryKey: ["nfe-inutilizacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pronto =
    Number(serie) >= 0 &&
    Number(inicial) >= 1 &&
    normalizarTexto(justificativa).length >= 15 &&
    !enviar.isPending;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        <Ban className="mr-2 size-4" />
        Inutilizar numeração
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Inutilizar numeração de NF-e</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Use para números que foram pulados e nunca viraram nota (falha, queda de energia, nota
            descartada antes de enviar). Número de nota já emitida não se inutiliza: cancele a nota.
            Máximo de {MAX_FAIXA_INUTILIZACAO} números por pedido. Não há como desfazer.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="inut-serie">Série</Label>
              <Input
                id="inut-serie"
                inputMode="numeric"
                value={serie}
                onChange={(e) => setSerie(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div>
              <Label htmlFor="inut-ini">Número inicial</Label>
              <Input
                id="inut-ini"
                inputMode="numeric"
                value={inicial}
                onChange={(e) => setInicial(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div>
              <Label htmlFor="inut-fim">Número final (vazio = só o inicial)</Label>
              <Input
                id="inut-fim"
                inputMode="numeric"
                value={final}
                onChange={(e) => setFinal(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="inut-just">Justificativa (mín. 15 caracteres)</Label>
            <Textarea
              id="inut-just"
              value={justificativa}
              maxLength={255}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Ex.: Numeração pulada por falha de comunicação com a Receita"
            />
          </div>
          <div>
            <Button variant="destructive" disabled={!pronto} onClick={() => enviar.mutate()}>
              Inutilizar na Receita
            </Button>
          </div>
          {(historico ?? []).length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">Últimos pedidos</p>
              {(historico ?? []).map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-2 border-t py-1">
                  <span>
                    Série {h.serie} · {h.numero_inicial}
                    {h.numero_final !== h.numero_inicial ? ` a ${h.numero_final}` : ""} ·{" "}
                    {SITUACAO[h.situacao] ?? h.situacao}
                    {h.protocolo ? ` · protocolo ${h.protocolo}` : ""}
                    {h.situacao !== "registrado" && h.mensagem ? ` · ${h.mensagem}` : ""}
                  </span>
                  {h.situacao === "pendente" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={atualizar.isPending}
                      onClick={() => atualizar.mutate(h.id)}
                    >
                      <RefreshCw className="mr-1 size-3" /> Atualizar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
