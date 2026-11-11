import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { minutosDesde } from "@/lib/restaurante";
import {
  CHAVE_REST,
  rpcRestaurante,
  tabela,
  type Comanda,
  type Mesa,
} from "@/lib/restaurante-dados";

/** Junta outras contas abertas do salão nesta: itens, pagamentos e pessoas passam para cá. */
export function JuntarContasDialog({
  comanda,
  rotulo,
  mesas,
  gestao,
  onFechar,
}: {
  comanda: Comanda;
  rotulo: string;
  mesas: Mesa[];
  gestao: boolean;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [usarTaxas, setUsarTaxas] = useState(false);

  const { data: outras = [] } = useQuery({
    queryKey: [CHAVE_REST, "comandas-para-juntar", comanda.id],
    queryFn: async () => {
      const r = await tabela("comandas")
        .select("*")
        .eq("situacao", "aberta")
        .eq("tipo", "salao")
        .neq("id", comanda.id)
        .order("aberta_em");
      if (r.error) throw new Error(r.error.message);
      return ((r.data ?? []) as unknown as Comanda[]).filter(
        (c) => (c.filial_id ?? null) === (comanda.filial_id ?? null),
      );
    },
  });

  const nome = (c: Comanda) => {
    const m = mesas.find((x) => x.id === c.mesa_id);
    return m ? `Mesa ${m.numero}` : `Comanda ${c.numero}`;
  };
  const diferem = (c: Comanda) =>
    Number(c.couvert_por_pessoa) !== Number(comanda.couvert_por_pessoa) ||
    Number(c.taxa_servico_percentual) !== Number(comanda.taxa_servico_percentual);
  const precisaAutorizar = outras.some((c) => escolhidas.includes(c.id) && diferem(c));

  const juntar = useMutation({
    mutationFn: () =>
      rpcRestaurante<{ unidas: number; itens: number }>("restaurante_juntar_comandas", {
        p_destino: comanda.id,
        p_origens: escolhidas,
        p_usar_taxas_destino: usarTaxas,
      }),
    onSuccess: (r) => {
      toast.success(`${r.unidas} conta(s) juntada(s) em ${rotulo}`);
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Juntar contas em {rotulo}</DialogTitle>
          <DialogDescription>
            Os itens, os pagamentos e as pessoas das contas escolhidas passam para esta conta. As
            outras ficam encerradas como “unidas” e as mesas ficam livres.
          </DialogDescription>
        </DialogHeader>

        {outras.length === 0 ? (
          <p className="text-sm text-muted-foreground">Não há outras contas abertas nesta loja.</p>
        ) : (
          <ul className="space-y-1">
            {outras.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded border p-2 text-sm">
                  <Checkbox
                    checked={escolhidas.includes(c.id)}
                    onCheckedChange={(v) =>
                      setEscolhidas((a) => (v ? [...a, c.id] : a.filter((x) => x !== c.id)))
                    }
                    aria-label={`Juntar ${nome(c)}`}
                  />
                  <span className="flex-1">
                    <strong>{nome(c)}</strong>
                    {c.cliente_nome ? ` · ${c.cliente_nome}` : ""}
                    {c.pessoas ? ` · ${c.pessoas} pessoas` : ""}
                    <span className="block text-xs text-muted-foreground">
                      aberta há {minutosDesde(c.aberta_em, new Date())} min
                      {diferem(c) ? " · serviço/couvert diferentes" : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {precisaAutorizar && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={usarTaxas}
              disabled={!gestao}
              onCheckedChange={(v) => setUsarTaxas(v === true)}
              aria-label="Usar serviço e couvert desta conta"
            />
            <span>
              Usar o serviço e o couvert desta conta para tudo.
              {!gestao && (
                <span className="block text-xs text-muted-foreground">
                  Só a gestão autoriza; peça a um administrador ou gestor.
                </span>
              )}
            </span>
          </label>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button
            onClick={() => juntar.mutate()}
            disabled={
              escolhidas.length === 0 || juntar.isPending || (precisaAutorizar && !usarTaxas)
            }
          >
            Juntar {escolhidas.length > 0 ? `(${escolhidas.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
