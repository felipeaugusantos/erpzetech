/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas e função novas ainda não estão nos tipos gerados do banco */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateTimeBR, num } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ItemCompra = {
  id: string;
  quantidade_recebida: number;
  custo_unitario: number;
  unidade: string | null;
  produtos: { codigo_interno: string | null; descricao: string } | null;
};

type Devolucao = {
  id: string;
  numero: number;
  modo: string;
  valor_total: number;
  valor_abatido: number;
  nfe_id: string | null;
  motivo: string | null;
  created_at: string;
};

export function DevolucaoCompra({
  compraId,
  itens,
  temChave,
}: {
  compraId: string;
  itens: ItemCompra[];
  /** A compra veio de XML e guarda a chave da NF-e de entrada (necessária para a nota de devolução). */
  temChave: boolean;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [qtds, setQtds] = useState<Record<string, string>>({});
  const [modo, setModo] = useState<"compra" | "nota">("compra");
  const [motivo, setMotivo] = useState("");
  const [abater, setAbater] = useState(true);

  const { data: devolvidos = [] } = useQuery({
    queryKey: ["compra-devolucao-itens", compraId],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("compra_devolucao_itens")
        .select("compra_item_id, quantidade, compra_devolucoes!inner(compra_id)")
        .eq("compra_devolucoes.compra_id", compraId);
      if (error) throw error;
      return (data ?? []) as { compra_item_id: string; quantidade: number }[];
    },
  });
  const { data: historico = [] } = useQuery({
    queryKey: ["compra-devolucoes", compraId],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("compra_devolucoes")
        .select("id, numero, modo, valor_total, valor_abatido, nfe_id, motivo, created_at")
        .eq("compra_id", compraId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Devolucao[];
    },
  });

  const jaDevolvido = (itemId: string) =>
    devolvidos
      .filter((d) => d.compra_item_id === itemId)
      .reduce((s, d) => s + Number(d.quantidade), 0);
  const saldo = (i: ItemCompra) => Math.max(0, Number(i.quantidade_recebida) - jaDevolvido(i.id));

  const escolhidos = useMemo(
    () =>
      itens
        .map((i) => ({ item: i, qtd: Number((qtds[i.id] ?? "").replace(",", ".")) }))
        .filter((x) => x.qtd > 0),
    [itens, qtds],
  );
  const total = escolhidos.reduce((s, x) => s + x.qtd * Number(x.item.custo_unitario), 0);
  const excedeu = escolhidos.some((x) => x.qtd > saldo(x.item) + 0.0001);

  const registrar = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("compra_devolucao_registrar", {
        p_compra_id: compraId,
        p_itens: escolhidos.map((x) => ({ compra_item_id: x.item.id, quantidade: x.qtd })),
        p_modo: modo,
        p_motivo: motivo.trim() || null,
        p_abater_pagar: abater,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(
        modo === "nota"
          ? "Devolução registrada. A nota de devolução está em Notas fiscais, pronta para enviar."
          : "Devolução registrada.",
      );
      setQtds({});
      setMotivo("");
      for (const k of [
        ["compra-devolucao-itens", compraId],
        ["compra-devolucoes", compraId],
        ["compra-itens", compraId],
        ["contas-pagar"],
        ["nfe"],
      ])
        await qc.invalidateQueries({ queryKey: k });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button variant="outline" onClick={() => setAberto(true)}>
        <Undo2 className="size-4" /> Devolver ao fornecedor
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Devolução ao fornecedor</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            A mercadoria sai do estoque do depósito que recebeu a compra, e o valor devolvido pode
            abater os títulos em aberto desta compra. Só dá para devolver o que foi recebido e ainda
            não foi devolvido.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Recebido</TableHead>
                <TableHead className="text-right">Já devolvido</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="w-32">Devolver</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.produtos?.descricao ?? "Produto"}</TableCell>
                  <TableCell className="text-right">
                    {num(Number(i.quantidade_recebida), 2)}
                  </TableCell>
                  <TableCell className="text-right">{num(jaDevolvido(i.id), 2)}</TableCell>
                  <TableCell className="text-right">{brl(Number(i.custo_unitario))}</TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      disabled={saldo(i) <= 0}
                      value={qtds[i.id] ?? ""}
                      onChange={(e) => setQtds({ ...qtds, [i.id]: e.target.value })}
                      placeholder={saldo(i) > 0 ? `até ${num(saldo(i), 2)}` : "—"}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Como registrar</Label>
              <Select value={modo} onValueChange={(v) => setModo(v as "compra" | "nota")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compra">Somente estoque e financeiro</SelectItem>
                  <SelectItem value="nota" disabled={!temChave}>
                    Com nota fiscal de devolução (NF-e)
                  </SelectItem>
                </SelectContent>
              </Select>
              {!temChave && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Esta compra não tem a chave da NF-e de entrada (só compras importadas do XML têm),
                  então a nota de devolução não está disponível.
                </p>
              )}
            </div>
            <div className="flex items-end gap-2">
              <Checkbox
                id="dev-abater"
                checked={abater}
                onCheckedChange={(v) => setAbater(v === true)}
              />
              <Label htmlFor="dev-abater">Abater o valor nas contas a pagar da compra</Label>
            </div>
          </div>
          <div>
            <Label htmlFor="dev-motivo">Motivo (opcional)</Label>
            <Textarea id="dev-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          {excedeu && (
            <p className="text-sm text-destructive">
              Alguma quantidade passa do que ainda pode ser devolvido.
            </p>
          )}
          {historico.length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">Devoluções desta compra</p>
              {historico.map((h) => (
                <div key={h.id} className="flex flex-wrap justify-between gap-2 border-t py-1">
                  <span>
                    Nº {h.numero} · {dateTimeBR(h.created_at)} · {brl(Number(h.valor_total))}
                    {h.motivo ? ` · ${h.motivo}` : ""}
                  </span>
                  <span className="text-muted-foreground">
                    {h.nfe_id ? (
                      <Link to="/nfe" className="underline">
                        Com nota fiscal
                      </Link>
                    ) : (
                      "Sem nota"
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="items-center">
            <span className="mr-auto text-sm">Total devolvido: {brl(total)}</span>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Fechar
            </Button>
            <Button
              disabled={registrar.isPending || escolhidos.length === 0 || excedeu}
              onClick={() => registrar.mutate()}
            >
              Registrar devolução
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
