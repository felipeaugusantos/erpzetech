import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { TIPOS_VEICULO } from "@/lib/lava-rapido";
import { dadosDoPlano, type FormPlano } from "@/lib/lava-planos-form";

const QUALQUER = "__qualquer";

export function PlanoDialog({
  aberto,
  form,
  setForm,
  servicos,
  onFechar,
  onSalvo,
}: {
  aberto: boolean;
  form: FormPlano;
  setForm: (f: FormPlano) => void;
  servicos: { id: string; nome: string; ativo: boolean }[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("lr_plano_salvar", { p_dados: dadosDoPlano(form) });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.id ? "Plano atualizado." : "Plano cadastrado.");
      onSalvo();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Editar plano" : "Novo plano"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="pl-nome">Nome</Label>
            <Input
              id="pl-nome"
              value={form.nome}
              placeholder="Ex.: Mensal 4 lavagens"
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="pl-serv">Serviço incluído</Label>
            <Select
              value={form.servico_id}
              onValueChange={(v) => setForm({ ...form, servico_id: v })}
            >
              <SelectTrigger id="pl-serv">
                <SelectValue placeholder="Escolha o serviço" />
              </SelectTrigger>
              <SelectContent>
                {servicos
                  .filter((s) => s.ativo || s.id === form.servico_id)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pl-lav">Lavagens</Label>
              <Input
                id="pl-lav"
                inputMode="numeric"
                value={form.lavagens}
                onChange={(e) => setForm({ ...form, lavagens: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="pl-val">Validade (dias)</Label>
              <Input
                id="pl-val"
                inputMode="numeric"
                value={form.validade_dias}
                onChange={(e) => setForm({ ...form, validade_dias: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pl-tipo">Vale para</Label>
              <Select
                value={form.tipo || QUALQUER}
                onValueChange={(v) => setForm({ ...form, tipo: v === QUALQUER ? "" : v })}
              >
                <SelectTrigger id="pl-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={QUALQUER}>Qualquer veículo</SelectItem>
                  {TIPOS_VEICULO.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pl-preco">Preço (R$)</Label>
              <Input
                id="pl-preco"
                inputMode="decimal"
                value={form.preco}
                onChange={(e) => setForm({ ...form, preco: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="pl-ativo"
              checked={form.ativo}
              onCheckedChange={(v) => setForm({ ...form, ativo: v })}
            />
            <Label htmlFor="pl-ativo">À venda</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Fidelidade({
  podeEditar,
  config,
  servicos,
  onSalvo,
}: {
  podeEditar: boolean;
  config: { ativo: boolean; lavagens_para_brinde: number; servico_id: string | null } | null;
  servicos: { id: string; nome: string }[];
  onSalvo: () => void;
}) {
  const [ativo, setAtivo] = useState(config?.ativo ?? false);
  const [lavagens, setLavagens] = useState(String(config?.lavagens_para_brinde ?? 10));
  const [servicoId, setServicoId] = useState(config?.servico_id ?? "");

  const salvar = useMutation({
    mutationFn: async () => {
      const n = Number(lavagens);
      if (!Number.isInteger(n) || n < 2 || n > 50)
        throw new Error("O brinde sai entre a 2ª e a 50ª lavagem.");
      if (ativo && !servicoId) throw new Error("Escolha o serviço que será o brinde.");
      const { error } = await supabase.rpc("lr_fidelidade_salvar", {
        p_ativo: ativo,
        p_lavagens: n,
        p_servico_id: servicoId || (null as unknown as string),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fidelidade salva.");
      onSalvo();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section>
      <h2 className="mb-1 font-display text-lg font-semibold">Fidelidade</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Cada lavagem entregue vale um selo. Ao juntar o número escolhido, a próxima lavagem do
        serviço-brinde sai sem cobrança. Os selos contam a partir do momento em que o programa é
        ligado.
      </p>
      <div className="panel grid max-w-xl gap-3 p-4">
        <div className="flex items-center gap-2">
          <Switch id="fd-ativo" checked={ativo} disabled={!podeEditar} onCheckedChange={setAtivo} />
          <Label htmlFor="fd-ativo">Programa ligado</Label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="fd-lav">Lavagens para ganhar o brinde</Label>
            <Input
              id="fd-lav"
              inputMode="numeric"
              value={lavagens}
              disabled={!podeEditar}
              onChange={(e) => setLavagens(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="fd-serv">Serviço-brinde</Label>
            <Select value={servicoId} disabled={!podeEditar} onValueChange={setServicoId}>
              <SelectTrigger id="fd-serv">
                <SelectValue placeholder="Escolha o serviço" />
              </SelectTrigger>
              <SelectContent>
                {servicos.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {podeEditar && (
          <div>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar fidelidade
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
