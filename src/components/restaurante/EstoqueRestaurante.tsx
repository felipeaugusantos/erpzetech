import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCardapio } from "@/hooks/useCardapio";
import { useFichaTecnica } from "@/hooks/useFichaTecnica";
import { brl } from "@/lib/format";
import { custoDoPrato, faixaCmv, margemDoPrato } from "@/lib/ficha-tecnica";
import { CHAVE_REST, tabela } from "@/lib/restaurante-dados";

/** Estoque do restaurante: depósito da cozinha, baixa pela ficha técnica e custo e margem de cada prato. */
export function EstoqueRestaurante({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const { data: dados, custos } = useFichaTecnica();
  const { data: cardapio } = useCardapio(true);
  const [baixa, setBaixa] = useState(false);
  const [deposito, setDeposito] = useState("");

  const { data: depositos = [] } = useQuery({
    queryKey: [CHAVE_REST, "depositos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("depositos")
        .select("id, nome, permite_negativo, ativo")
        .order("nome");
      if (error) throw error;
      return (data ?? []).filter((d) => d.ativo);
    },
  });

  // começa pelo que já está salvo
  const config = dados?.config;
  useEffect(() => {
    if (config) {
      setBaixa(config.baixa_estoque);
      setDeposito(config.deposito_id ?? "");
    }
  }, [config]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (baixa && !deposito) throw new Error("Escolha o depósito da cozinha para dar baixa");
      const r = await tabela("restaurante_config").upsert(
        {
          tenant_id: tenantId,
          baixa_estoque: baixa,
          deposito_id: deposito || null,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "tenant_id" },
      );
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => {
      toast.success("Configuração de estoque salva");
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const escolhido = depositos.find((d) => d.id === deposito);

  // custo e margem de cada prato ativo
  const pratos = useMemo(() => {
    return (cardapio?.itens ?? []).map((i) => {
      const linhas = (dados?.ficha ?? []).filter((f) => f.item_id === i.id);
      let custo: number | null = null;
      let origem: "ficha" | "revenda" | "sem" = "sem";
      if (linhas.length > 0) {
        custo = custoDoPrato(
          linhas.map((l) => ({
            quantidade: Number(l.quantidade),
            perda_percentual: Number(l.perda_percentual),
            custoUnitario: custos.get(l.produto_id) ?? 0,
          })),
        );
        origem = "ficha";
      } else if (i.produto_id) {
        custo = custos.get(i.produto_id) ?? 0;
        origem = "revenda";
      }
      return {
        item: i,
        custo,
        origem,
        margem: custo === null ? null : margemDoPrato(Number(i.preco), custo),
      };
    });
  }, [cardapio, dados, custos]);

  const semFicha = pratos.filter((p) => p.origem === "sem").length;

  return (
    <div className="mt-4 max-w-3xl space-y-5">
      <section className="space-y-3 rounded border bg-secondary/40 p-3">
        <h3 className="font-display font-semibold">Baixa de estoque pela ficha técnica</h3>
        <p className="text-sm text-muted-foreground">
          Quando ligada, ao enviar o pedido à cozinha os insumos da ficha saem do depósito escolhido
          (bebida de revenda ligada a um produto baixa 1 unidade). Se o item for cancelado antes de
          a cozinha começar, os insumos voltam; depois disso, foram consumidos.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={baixa} onCheckedChange={setBaixa} aria-label="Dar baixa nos insumos" />
          Dar baixa nos insumos ao enviar à cozinha
        </label>
        <div className="max-w-xs">
          <Label>Depósito da cozinha</Label>
          <Select value={deposito} onValueChange={setDeposito}>
            <SelectTrigger aria-label="Depósito da cozinha">
              <SelectValue placeholder="Escolha o depósito" />
            </SelectTrigger>
            <SelectContent>
              {depositos.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {baixa && escolhido && !escolhido.permite_negativo && (
          <p className="text-xs text-amber-700">
            Este depósito não permite saldo negativo: se faltar insumo, o envio do pedido à cozinha
            é recusado. Para nunca parar o serviço, permita saldo negativo no cadastro do depósito.
          </p>
        )}
        <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
          Salvar
        </Button>
      </section>

      <section>
        <h3 className="mb-1 font-display font-semibold">Custo e margem dos pratos</h3>
        <p className="mb-2 text-sm text-muted-foreground">
          O custo vem da ficha técnica, com o custo médio dos insumos no depósito da cozinha. CMV é
          o custo dividido pelo preço de venda.
          {semFicha > 0 && ` ${semFicha} item(ns) ainda sem ficha ou produto ligado.`}
        </p>
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <th className="p-2">Item</th>
                <th className="p-2 text-right">Preço</th>
                <th className="p-2 text-right">Custo</th>
                <th className="p-2 text-right">Lucro</th>
                <th className="p-2 text-right">CMV</th>
              </tr>
            </thead>
            <tbody>
              {pratos.map(({ item, custo, origem, margem }) => (
                <tr key={item.id} className="border-t">
                  <td className="p-2">
                    {item.nome}
                    {origem === "revenda" && (
                      <Badge variant="outline" className="ml-2">
                        revenda
                      </Badge>
                    )}
                  </td>
                  <td className="p-2 text-right">{brl(item.preco)}</td>
                  {margem && custo !== null ? (
                    <>
                      <td className="p-2 text-right">{brl(custo)}</td>
                      <td className="p-2 text-right">{brl(margem.lucro)}</td>
                      <td
                        className={`p-2 text-right font-semibold ${
                          faixaCmv(margem.cmvPercentual) === "bom"
                            ? "text-emerald-700"
                            : faixaCmv(margem.cmvPercentual) === "atencao"
                              ? "text-amber-700"
                              : "text-destructive"
                        }`}
                      >
                        {margem.cmvPercentual}%
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} className="p-2 text-right text-muted-foreground">
                      sem ficha
                    </td>
                  )}
                </tr>
              ))}
              {pratos.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-muted-foreground">
                    Cadastre os itens do cardápio para ver o custo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
