import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import {
  entrarContingenciaNfe,
  sairContingenciaNfe,
  situacaoContingenciaNfe,
} from "@/lib/nfe-fiscal.functions";
import { normalizarTexto } from "@/lib/nfe-eventos";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Servico = { emOperacao: boolean; motivo: string | null } | null;

const rotulo = (s: Servico) =>
  s === null
    ? "não consultado"
    : s.emOperacao
      ? "em operação"
      : `fora do ar${s.motivo ? ` (${s.motivo})` : ""}`;

export function ContingenciaNfe() {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [justificativa, setJustificativa] = useState("");

  const situacao = useServerFn(situacaoContingenciaNfe);
  const entrar = useServerFn(entrarContingenciaNfe);
  const sair = useServerFn(sairContingenciaNfe);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["nfe-contingencia"],
    queryFn: async () => situacao(),
    staleTime: 60_000,
  });

  const atualizar = async () => {
    await qc.invalidateQueries({ queryKey: ["nfe-contingencia"] });
  };
  const entrarM = useMutation({
    mutationFn: async () => entrar({ data: { justificativa } }),
    onSuccess: async (r: { autorizador: string }) => {
      toast.success(`Contingência ligada: as próximas notas saem pela ${r.autorizador}`);
      setJustificativa("");
      await atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const sairM = useMutation({
    mutationFn: async () => sair(),
    onSuccess: async () => {
      toast.success("Contingência encerrada: as próximas notas saem pela Sefaz normal");
      await atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const emContingencia = !!data?.contingencia;

  return (
    <>
      <Button
        variant={emContingencia ? "destructive" : "outline"}
        size="sm"
        onClick={() => setAberto(true)}
      >
        <ShieldAlert className="mr-2 size-4" />
        {emContingencia ? "Em contingência" : "Contingência"}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Contingência da NF-e (SVC)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Use só quando a Sefaz do seu estado estiver fora do ar. Com a contingência ligada, as
            notas deste emitente são autorizadas pelo ambiente de contingência
            {data?.svc ? ` (${data.svc.nome})` : ""} e saem marcadas como emitidas em contingência.
            Desligue assim que a Sefaz normal voltar.
          </p>
          <div className="space-y-1 text-sm">
            <p>
              Sefaz do estado: <strong>{rotulo(data?.normal ?? null)}</strong>
            </p>
            <p>
              {data?.svc?.nome ?? "SVC"}: <strong>{rotulo(data?.servicoSvc ?? null)}</strong>
            </p>
            <Button size="sm" variant="secondary" disabled={isFetching} onClick={() => refetch()}>
              <RefreshCw className="mr-1 size-3" /> Atualizar situação
            </Button>
          </div>
          {data?.contingencia ? (
            <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="font-medium">
                Em contingência pela{" "}
                {data.contingencia.autorizador === "SVCRS" ? "SVC-RS" : "SVC-AN"} desde{" "}
                {new Date(data.contingencia.entrouEm).toLocaleString("pt-BR")}
              </p>
              <p className="text-muted-foreground">{data.contingencia.justificativa}</p>
              <Button disabled={sairM.isPending} onClick={() => sairM.mutate()}>
                Encerrar contingência
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="cont-just">Justificativa (15 a 256 caracteres)</Label>
              <Textarea
                id="cont-just"
                value={justificativa}
                maxLength={256}
                onChange={(e) => setJustificativa(e.target.value)}
                placeholder="Ex.: Sefaz do estado fora do ar desde as 10h, sem previsão de retorno"
              />
              <Button
                variant="destructive"
                disabled={entrarM.isPending || normalizarTexto(justificativa).length < 15}
                onClick={() => entrarM.mutate()}
              >
                Ligar contingência
              </Button>
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
