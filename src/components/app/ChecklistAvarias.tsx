import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { dateTimeBR } from "@/lib/format";
import {
  TIPOS_AVARIA,
  estadoDoChecklist,
  formatarIdentificacao,
  locaisDeAvaria,
  rotuloAvaria,
} from "@/lib/lava-rapido";
import { supabase } from "@/integrations/supabase/client";

export type AvariaLinha = {
  id: string;
  lugar: string;
  tipo: string;
  descricao: string | null;
};

type OrdemChecklist = {
  id: string;
  checklist_em: string | null;
  checklist_sem_avarias: boolean | null;
};

/**
 * Checklist de avarias na entrada do veículo: a recepção registra o que já existe ou confirma que não há nada.
 * Depois de concluído, o que foi registrado não se apaga (o banco também confere).
 */
export function ChecklistAvarias({
  ordem,
  veiculo,
  avarias,
  onFechar,
}: {
  ordem: OrdemChecklist;
  veiculo: { tipo: string; identificacao: string };
  avarias: AvariaLinha[];
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [lugar, setLugar] = useState("");
  const [tipo, setTipo] = useState("risco");
  const [descricao, setDescricao] = useState("");
  const estado = estadoDoChecklist(ordem);
  const concluido = estado !== "pendente";
  const atualizar = () => void qc.invalidateQueries({ queryKey: ["lava-patio"] });

  const registrar = useMutation({
    mutationFn: async () => {
      if (lugar.trim().length < 2) throw new Error("Informe o local da avaria.");
      const { error } = await supabase.rpc("lr_avaria_registrar", {
        p_ordem_id: ordem.id,
        p_local: lugar.trim(),
        p_tipo: tipo,
        ...(descricao.trim() ? { p_descricao: descricao.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setLugar("");
      setDescricao("");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("lr_avaria_remover", { p_id: id });
      if (error) throw error;
    },
    onSuccess: atualizar,
    onError: (e: Error) => toast.error(e.message),
  });

  const concluir = useMutation({
    mutationFn: async (semAvarias: boolean) => {
      const { error } = await supabase.rpc("lr_checklist_concluir", {
        p_ordem_id: ordem.id,
        p_sem_avarias: semAvarias,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Checklist concluído.");
      atualizar();
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Checklist de avarias — {formatarIdentificacao(veiculo.tipo, veiculo.identificacao)}
          </DialogTitle>
        </DialogHeader>

        {concluido && (
          <p className="rounded-md bg-secondary px-3 py-2 text-sm">
            Checklist concluído em {dateTimeBR(ordem.checklist_em)}.{" "}
            {estado === "sem_avarias"
              ? "O veículo entrou sem avarias."
              : "As avarias registradas não se apagam."}
          </p>
        )}

        {avarias.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma avaria registrada.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {avarias.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-2 p-2 text-sm">
                <span>
                  <strong>{a.lugar}</strong> · {rotuloAvaria(a.tipo)}
                  {a.descricao ? (
                    <span className="block text-muted-foreground">{a.descricao}</span>
                  ) : null}
                </span>
                {!concluido && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remover avaria em ${a.lugar}`}
                    disabled={remover.isPending}
                    onClick={() => remover.mutate(a.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 border-t pt-3">
          <p className="text-sm font-medium">
            {concluido ? "Avaria achada depois" : "Registrar avaria"}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="av-lugar">Local</Label>
              <Input
                id="av-lugar"
                list="av-sugestoes"
                value={lugar}
                placeholder="Ex.: Capô"
                onChange={(e) => setLugar(e.target.value)}
              />
              <datalist id="av-sugestoes">
                {locaisDeAvaria(veiculo.tipo).map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>
            <div>
              <Label htmlFor="av-tipo">Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger id="av-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_AVARIA.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="av-desc">Descrição (opcional)</Label>
            <Input
              id="av-desc"
              value={descricao}
              maxLength={300}
              placeholder="Ex.: risco de uns 10 cm"
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={registrar.isPending}
              onClick={() => registrar.mutate()}
            >
              Adicionar avaria
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
          {!concluido &&
            (avarias.length === 0 ? (
              <Button disabled={concluir.isPending} onClick={() => concluir.mutate(true)}>
                Concluir: sem avarias
              </Button>
            ) : (
              <Button disabled={concluir.isPending} onClick={() => concluir.mutate(false)}>
                Concluir com {avarias.length} {avarias.length === 1 ? "avaria" : "avarias"}
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
