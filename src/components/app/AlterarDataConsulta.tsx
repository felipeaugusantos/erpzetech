import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { DataAtendimento } from "@/components/app/DataAtendimento";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { dataClinica, erroAlteracaoDataConsulta, type AtendimentoClinico } from "@/lib/clinica";

export function AlterarDataConsulta({
  atendimento,
  petId,
}: {
  atendimento: AtendimentoClinico;
  petId: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState("");
  const qc = useQueryClient();
  const anterior = atendimento.data_atendimento ?? dataClinica(atendimento.aberto_em);
  const erro = erroAlteracaoDataConsulta(
    data,
    atendimento.pet?.nascimento ?? null,
    atendimento.situacao === "fechado",
    "",
  );
  const salvar = useMutation({
    mutationFn: async () => {
      if (erro) throw new Error(erro);
      const { error } = await supabase.rpc("clinica_consulta_data_alterar", {
        p_id: atendimento.id,
        p_data: data,
        p_motivo: "",
        p_data_anterior: anterior,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["clinica-historico", petId] }),
        qc.invalidateQueries({ queryKey: ["clinica-atendimento"] }),
        qc.invalidateQueries({ queryKey: ["clinica-pacientes-atendidos"] }),
      ]);
      toast.success("Data da consulta atualizada");
      setOpen(false);
    },
    onError: (e: Error) =>
      toast.error("Não foi possível alterar a data", { description: e.message }),
  });
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setData(anterior);
          setOpen(true);
        }}
      >
        <CalendarIcon className="size-4" /> Alterar data
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!salvar.isPending) setOpen(next);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Alterar data da consulta</DialogTitle>
          </DialogHeader>
          <DataAtendimento value={data} onChange={setData} disabled={salvar.isPending} />
          {erro && data !== anterior && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={salvar.isPending} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={salvar.isPending || !!erro || data === anterior}
              onClick={() => salvar.mutate()}
            >
              {salvar.isPending ? "Salvando…" : "Salvar data"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
