import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { limparPdfsExcluidos } from "@/lib/exame-exclusao.functions";
import { excluirExameSchema } from "@/lib/exame-exclusao";
import { type ExameClinico, SITUACOES_EXAME } from "@/lib/exames";
import { dateBR } from "@/lib/format";
import { rotulo } from "@/lib/pet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ExcluirExame({ exame, disabled, onExcluido }: { exame: ExameClinico; disabled: boolean; onExcluido: () => void }) {
  const qc = useQueryClient();
  const limpar = useServerFn(limparPdfsExcluidos);
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const excluir = useMutation({
    mutationFn: async () => {
      const entrada = excluirExameSchema.parse({ id: exame.id, motivo, confirmado });
      const resposta = await supabase.rpc("clinica_exame_excluir", { p_id: entrada.id, p_motivo: entrada.motivo, p_confirmado: entrada.confirmado });
      if (resposta.error) throw resposta.error;
      return resposta.data;
    },
    onSuccess: async () => {
      setOpen(false);
      toast.success("Exame excluído. Motivo e responsável registrados no log.");
      try {
        if ((await limpar()).pendentes > 0) toast.warning("Exame excluído; limpeza dos PDFs pendente.");
      } catch { toast.warning("Exame excluído; limpeza dos PDFs será tentada novamente ao abrir Exames."); }
      qc.removeQueries({ queryKey: ["clinica-exame", exame.id], exact: true });
      // Patient histories and persisted clinical/portal data must not retain the deleted exam.
      qc.removeQueries({ predicate: q => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("clinica-") && !q.isActive() });
      void qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("clinica-") });
      onExcluido();
    },
    onError: (e: Error) => toast.error("Não foi possível excluir o exame", { description: e.message }),
  });
  return <>
    <Button variant="destructive" disabled={disabled || excluir.isPending} onClick={() => { setMotivo(""); setConfirmado(false); setOpen(true); }}><Trash2 className="size-4" />Excluir exame</Button>
    <Dialog open={open} onOpenChange={o => { if (!excluir.isPending) setOpen(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Excluir exame definitivamente</DialogTitle></DialogHeader>
        <p className="text-sm"><strong>{exame.pet.nome} · {exame.nome}</strong><br />Coleta {dateBR(exame.data_coleta)} · {rotulo(SITUACOES_EXAME, exame.situacao)}</p>
        <p className="text-sm text-destructive">O exame, os resultados, adendos e PDFs serão removidos. O tutor perderá acesso ao laudo. Não é possível desfazer.</p>
        {exame.situacao === "fechado" && <p className="text-sm font-medium">Este laudo já foi fechado. A exclusão também o retira do histórico e da evolução.</p>}
        <div className="grid gap-2"><Label htmlFor="exclusao-motivo">Motivo da exclusão (registrado no log)</Label><Textarea id="exclusao-motivo" maxLength={500} value={motivo} onChange={e => setMotivo(e.target.value)} disabled={excluir.isPending} /></div>
        <Label className="flex items-start gap-2"><Checkbox checked={confirmado} onCheckedChange={v => setConfirmado(v === true)} disabled={excluir.isPending} />Confirmo a exclusão definitiva deste exame.</Label>
        <DialogFooter><Button variant="outline" disabled={excluir.isPending} onClick={() => setOpen(false)}>Voltar</Button><Button variant="destructive" disabled={excluir.isPending || !confirmado || !motivo.trim()} onClick={() => excluir.mutate()}>{excluir.isPending ? "Excluindo…" : "Excluir definitivamente"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}