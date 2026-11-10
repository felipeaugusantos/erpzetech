import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { Button } from "@/components/ui/button";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Gera o rascunho da NF-e complementar (só de valor) de uma nota de venda autorizada. */
export function NotaComplementar({ nfeId, aoGerar }: { nfeId: string; aoGerar?: () => void }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");

  const { data: itens = [] } = useQuery({
    queryKey: ["nfe-itens-complemento", nfeId],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nfe_itens")
        .select("id, descricao, total")
        .eq("nfe_id", nfeId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const escolhidos = itens
    .map((i) => ({ id: i.id, valor: Number((valores[i.id] ?? "").replace(",", ".")) }))
    .filter((x) => x.valor > 0);

  const gerar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("nfe_complementar_gerar", {
        p_nfe_id: nfeId,
        p_itens: escolhidos.map((x) => ({ nfe_item_id: x.id, valor: x.valor })),
        ...(motivo.trim() ? { p_motivo: motivo.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Nota complementar criada em Notas fiscais, pronta para conferir e enviar.");
      setValores({});
      setMotivo("");
      setAberto(false);
      await qc.invalidateQueries({ queryKey: ["nfe"] });
      aoGerar?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button variant="secondary" onClick={() => setAberto(true)}>
        <FilePlus2 className="mr-2 size-4" /> Nota complementar
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nota complementar (só de valor)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Use para cobrar uma diferença de VALOR em itens desta nota (preço ou imposto que ficou a
            menos). Ela NÃO corrige quantidade, destinatário nem dados cadastrais: nesses casos use
            a carta de correção ou cancele e emita outra. Informe o valor adicional de cada item; os
            impostos são calculados sobre esse valor. Confirme com o contador antes de enviar.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Total na nota</TableHead>
                <TableHead className="w-40">Valor a complementar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.descricao}</TableCell>
                  <TableCell className="text-right">{brl(Number(i.total))}</TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      value={valores[i.id] ?? ""}
                      onChange={(e) => setValores({ ...valores, [i.id]: e.target.value })}
                      placeholder="0,00"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div>
            <Label htmlFor="compl-motivo">Motivo (vai na mensagem da nota)</Label>
            <Textarea
              id="compl-motivo"
              value={motivo}
              maxLength={200}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: diferença de preço acordada após a emissão"
            />
          </div>
          <DialogFooter className="items-center">
            <span className="mr-auto text-sm">
              Total a complementar: {brl(escolhidos.reduce((s, x) => s + x.valor, 0))}
            </span>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Fechar
            </Button>
            <Button
              disabled={gerar.isPending || escolhidos.length === 0}
              onClick={() => gerar.mutate()}
            >
              Criar nota complementar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
