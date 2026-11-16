import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  erroDosSinais,
  formDoAtendimento,
  type AtendimentoClinico,
  type FormAtendimento,
} from "@/lib/clinica";

const TEXTOS: { chave: keyof FormAtendimento; rotulo: string; linhas: number }[] = [
  { chave: "queixa", rotulo: "Queixa", linhas: 2 },
  { chave: "anamnese", rotulo: "Anamnese", linhas: 3 },
  { chave: "exame_fisico", rotulo: "Exame físico", linhas: 3 },
  { chave: "diagnostico", rotulo: "Diagnóstico", linhas: 2 },
  { chave: "conduta", rotulo: "Conduta", linhas: 3 },
];

/** Corrige um atendimento já fechado: o motivo é obrigatório e a versão anterior fica guardada no adendo da correção. */
export function CorrigirAtendimento({
  atendimento,
  petId,
  aoCorrigir,
}: {
  atendimento: AtendimentoClinico;
  petId?: string;
  aoCorrigir?: (novo: AtendimentoClinico) => void;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormAtendimento>(() => formDoAtendimento(atendimento));
  const [motivo, setMotivo] = useState("");
  const original = formDoAtendimento(atendimento);
  const mudou = (Object.keys(original) as (keyof FormAtendimento)[]).some(
    (k) => k !== "data_atendimento" && (form[k] ?? "") !== (original[k] ?? ""),
  );
  const erro =
    erroDosSinais(form) ??
    (form.queixa.trim() === "" ? "A queixa não pode ficar vazia" : null) ??
    (form.conduta.trim() === "" ? "A conduta não pode ficar vazia" : null);

  const corrigir = useMutation({
    mutationFn: async () => {
      if (erro) throw new Error(erro);
      if (motivo.trim() === "") throw new Error("Informe o motivo da correção");
      const { data, error } = await supabase.rpc("clinica_atendimento_corrigir", {
        p_id: atendimento.id,
        p_dados: { ...form, data_atendimento: undefined } as unknown as Json,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
      return data as unknown as AtendimentoClinico;
    },
    onSuccess: async (novo) => {
      aoCorrigir?.(novo);
      await Promise.all([
        qc.invalidateQueries({
          queryKey: petId ? ["clinica-historico", petId] : ["clinica-historico"],
        }),
        qc.invalidateQueries({ queryKey: ["clinica-atendimento"] }),
      ]);
      toast.success("Atendimento corrigido", {
        description: "A correção ficou registrada no histórico com o seu nome e o motivo.",
      });
      setAberto(false);
    },
    onError: (e: Error) => toast.error("Não foi possível corrigir", { description: e.message }),
  });

  const mexe = (k: keyof FormAtendimento, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setForm(formDoAtendimento(atendimento));
          setMotivo("");
          setAberto(true);
        }}
      >
        <Pencil className="size-4" /> Corrigir atendimento
      </Button>
      <Dialog open={aberto} onOpenChange={(o) => !corrigir.isPending && setAberto(o)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Corrigir atendimento</DialogTitle>
            <DialogDescription>
              O que mudar fica registrado como correção, com seu nome, CRMV, o motivo e o valor
              anterior. O texto original continua guardado no histórico.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <Label htmlFor="cc-peso">Peso (kg)</Label>
                <Input
                  id="cc-peso"
                  inputMode="decimal"
                  value={form.peso_kg}
                  onChange={(e) => mexe("peso_kg", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cc-temp">Temperatura (°C)</Label>
                <Input
                  id="cc-temp"
                  inputMode="decimal"
                  value={form.temperatura_c}
                  onChange={(e) => mexe("temperatura_c", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cc-fc">Freq. cardíaca</Label>
                <Input
                  id="cc-fc"
                  inputMode="numeric"
                  value={form.freq_cardiaca}
                  onChange={(e) => mexe("freq_cardiaca", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cc-fr">Freq. respiratória</Label>
                <Input
                  id="cc-fr"
                  inputMode="numeric"
                  value={form.freq_respiratoria}
                  onChange={(e) => mexe("freq_respiratoria", e.target.value)}
                />
              </div>
            </div>
            {TEXTOS.map((t) => (
              <div key={t.chave}>
                <Label htmlFor={`cc-${t.chave}`}>{t.rotulo}</Label>
                <Textarea
                  id={`cc-${t.chave}`}
                  rows={t.linhas}
                  value={form[t.chave] ?? ""}
                  onChange={(e) => mexe(t.chave, e.target.value)}
                />
              </div>
            ))}
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <div>
                <Label htmlFor="cc-retorno">Retorno sugerido</Label>
                <Input
                  id="cc-retorno"
                  type="date"
                  value={form.retorno_em}
                  onChange={(e) => mexe("retorno_em", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cc-obs">Observações</Label>
                <Input
                  id="cc-obs"
                  value={form.observacoes}
                  onChange={(e) => mexe("observacoes", e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="cc-motivo">Motivo da correção *</Label>
              <Textarea
                id="cc-motivo"
                rows={2}
                maxLength={2000}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
            {mudou && erro && (
              <p role="alert" className="text-sm text-destructive">
                {erro}
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={corrigir.isPending}
              onClick={() => setAberto(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={corrigir.isPending || !mudou || !!erro || motivo.trim() === ""}
              onClick={() => corrigir.mutate()}
            >
              {corrigir.isPending ? "Salvando…" : "Salvar correção"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
