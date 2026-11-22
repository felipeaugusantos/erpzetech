import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { corpoLaudoFivFelv, RESULTADOS_TESTE, type DadosFivFelv } from "@/lib/laudo-fiv-felv";

export function LaudoFivFelv({
  petId,
  atendimentoId,
  nome,
  fechar,
}: {
  petId: string;
  atendimentoId?: string;
  nome: string;
  fechar: () => void;
}) {
  const [dados, setDados] = useState<DadosFivFelv>({
    amostra: "",
    data: "",
    produto: "",
    lote: "",
    validade: "",
    fiv: "",
    felv: "",
    observacao: "",
  });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const alterar = (campo: keyof DadosFivFelv, valor: string) =>
    setDados((d) => ({ ...d, [campo]: valor }));
  const emitir = useMutation({
    mutationFn: async () => {
      const corpo = corpoLaudoFivFelv(dados);
      const { data, error } = await supabase.rpc("clinica_documento_emitir", {
        p_dados: {
          tipo: "atestado",
          titulo: "Laudo FIV / FeLV",
          pet_id: petId,
          ...(atendimentoId ? { atendimento_id: atendimentoId } : {}),
          corpo,
          itens: [],
        },
      });
      if (error) throw error;
      return data as unknown as { id: string };
    },
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ["clinica-documentos"] });
      toast.success("Laudo emitido");
      fechar();
      void navigate({ to: "/clinica-documento", search: { id: d.id } });
    },
    onError: (e: Error) => toast.error("Não foi possível emitir", { description: e.message }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Laudo FIV / FeLV — {nome}</DialogTitle>
        </DialogHeader>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {(
            [
              ["amostra", "Amostra utilizada", "text"],
              ["data", "Data de execução do teste", "date"],
              ["produto", "Produto", "text"],
              ["lote", "Lote", "text"],
              ["validade", "Validade do produto", "text"],
            ] as const
          ).map(([campo, rotulo, tipo]) => (
            <div key={campo} className="min-w-0">
              <Label htmlFor={`teste-${campo}`}>{rotulo} *</Label>
              <Input
                id={`teste-${campo}`}
                type={tipo}
                required
                maxLength={200}
                value={dados[campo]}
                onChange={(e) => alterar(campo, e.target.value)}
              />
            </div>
          ))}
          {(["fiv", "felv"] as const).map((campo) => (
            <div key={campo} className="min-w-0">
              <Label htmlFor={`teste-${campo}`}>{campo === "fiv" ? "FIV" : "FeLV"} *</Label>
              <Select value={dados[campo]} onValueChange={(v) => alterar(campo, v)}>
                <SelectTrigger id={`teste-${campo}`} className="w-full">
                  <SelectValue placeholder="Selecionar resultado" />
                </SelectTrigger>
                <SelectContent>
                  {RESULTADOS_TESTE.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          <div className="sm:col-span-2">
            <Label htmlFor="teste-observacao">Observações</Label>
            <Textarea
              id="teste-observacao"
              maxLength={2000}
              value={dados.observacao}
              onChange={(e) => alterar("observacao", e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>
            Voltar
          </Button>
          <Button disabled={emitir.isPending} onClick={() => emitir.mutate()}>
            {emitir.isPending ? "Emitindo…" : "Emitir laudo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
