import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import type { ParametroSinal } from "@/lib/sinais-vitais";

type Form = { id?: string; nome: string; unidade: string; ativo: boolean };
const VAZIO: Form = { nome: "", unidade: "", ativo: true };

/**
 * Catálogo de parâmetros de sinais vitais da empresa (nome e unidade). Nasce vazio: quem define é a clínica. O sistema não
 * guarda faixas, valores normais nem alertas. Mudar nome ou unidade não altera medições já registradas.
 */
export function ParametrosSinaisDialog({ aoFechar }: { aoFechar: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(VAZIO);

  const { data: lista = [], isLoading } = useQuery({
    queryKey: ["clinica-sinais-parametros", "todos"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_sinais_parametros", { p_todos: true });
      if (error) throw error;
      return (data ?? []) as unknown as ParametroSinal[];
    },
  });

  const salvar = useMutation({
    mutationFn: async (f: Form) => {
      const { error } = await supabase.rpc("clinica_sinais_parametro_salvar", {
        p_dados: {
          ...(f.id ? { id: f.id } : {}),
          nome: f.nome.trim(),
          unidade: f.unidade.trim(),
          ativo: f.ativo,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parâmetro salvo");
      setForm(VAZIO);
      void qc.invalidateQueries({ queryKey: ["clinica-sinais-parametros"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const invalido = !form.nome.trim() || !form.unidade.trim();

  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Parâmetros de sinais vitais</DialogTitle>
          <DialogDescription>
            Defina o que a clínica mede na internação e a unidade de cada medida. O sistema não
            define valores normais nem alertas. Mudar o nome ou a unidade não altera medições já
            registradas.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="panel h-20 animate-pulse" />
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum parâmetro cadastrado ainda. Cadastre o primeiro abaixo (por exemplo, temperatura
            em °C).
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Parâmetros cadastrados">
            {lista.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
              >
                <span className={p.ativo ? "" : "text-muted-foreground"}>
                  <strong>{p.nome}</strong> · {p.unidade}
                  {!p.ativo && " (desativado)"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setForm({ id: p.id, nome: p.nome, unidade: p.unidade, ativo: p.ativo })
                  }
                >
                  Editar
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3 rounded-md border border-border p-3">
          <h4 className="text-sm font-semibold">
            {form.id ? "Editar parâmetro" : "Novo parâmetro"}
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ps-nome">Nome</Label>
              <Input
                id="ps-nome"
                maxLength={40}
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="ps-unidade">Unidade</Label>
              <Input
                id="ps-unidade"
                maxLength={20}
                placeholder="°C, bpm, mmHg…"
                value={form.unidade}
                onChange={(e) => setForm({ ...form, unidade: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="ps-ativo"
              checked={form.ativo}
              onCheckedChange={(v) => setForm({ ...form, ativo: v })}
            />
            <Label htmlFor="ps-ativo">Disponível para registrar</Label>
          </div>
          <div className="flex gap-2">
            <Button disabled={invalido || salvar.isPending} onClick={() => salvar.mutate(form)}>
              {salvar.isPending ? "Salvando…" : "Salvar parâmetro"}
            </Button>
            {form.id && (
              <Button variant="outline" onClick={() => setForm(VAZIO)}>
                Cancelar edição
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
