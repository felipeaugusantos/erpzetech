import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFichaTecnica } from "@/hooks/useFichaTecnica";
import { brl } from "@/lib/format";
import { consumoReal, custoDoPrato, faixaCmv, margemDoPrato } from "@/lib/ficha-tecnica";
import { CHAVE_REST, tabela, type FichaTecnica } from "@/lib/restaurante-dados";

const paraNumero = (v: string) => Number(v.replace(",", ".")) || 0;
const texto = (n: number) => String(n).replace(".", ",");

/**
 * Insumos que um prato (ou uma opção, como "bacon extra") consome por unidade vendida.
 * `preco` é o preço do prato, para mostrar custo e margem (opções mostram só o custo extra).
 */
export function FichaEditor({
  alvo,
  tenantId,
  preco,
}: {
  alvo: { tipo: "item" | "opcao"; id: string };
  tenantId: string;
  preco?: number;
}) {
  const qc = useQueryClient();
  const { data, custos, produtosPorId } = useFichaTecnica();
  const [busca, setBusca] = useState("");

  const linhas = useMemo(
    () =>
      (data?.ficha ?? []).filter(
        (f) => (alvo.tipo === "item" ? f.item_id : f.opcao_id) === alvo.id,
      ),
    [data, alvo],
  );
  const usados = new Set(linhas.map((l) => l.produto_id));

  const sugestoes = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (t.length < 2) return [];
    return (data?.produtos ?? [])
      .filter(
        (p) =>
          !usados.has(p.id) &&
          (p.descricao.toLowerCase().includes(t) ||
            (p.codigo_interno ?? "").toLowerCase().includes(t)),
      )
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, data]);

  const atualizar = () => void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
  const erro = (e: Error) => toast.error(e.message);

  const adicionar = useMutation({
    mutationFn: async (produtoId: string) => {
      const r = await tabela("cardapio_ficha").insert({
        tenant_id: tenantId,
        ...(alvo.tipo === "item" ? { item_id: alvo.id } : { opcao_id: alvo.id }),
        produto_id: produtoId,
        quantidade: 1,
        perda_percentual: 0,
      } as never);
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => {
      setBusca("");
      atualizar();
    },
    onError: erro,
  });

  const alterar = useMutation({
    mutationFn: async (p: {
      id: string;
      dados: Partial<Pick<FichaTecnica, "quantidade" | "perda_percentual">>;
    }) => {
      const r = await tabela("cardapio_ficha")
        .update(p.dados as never)
        .eq("id", p.id);
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: atualizar,
    onError: erro,
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const r = await tabela("cardapio_ficha").delete().eq("id", id);
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: atualizar,
    onError: erro,
  });

  const custo = custoDoPrato(
    linhas.map((l) => ({
      quantidade: Number(l.quantidade),
      perda_percentual: Number(l.perda_percentual),
      custoUnitario: custos.get(l.produto_id) ?? 0,
    })),
  );
  const margem = alvo.tipo === "item" && preco !== undefined ? margemDoPrato(preco, custo) : null;
  const semCusto = linhas.some((l) => (custos.get(l.produto_id) ?? 0) <= 0);

  return (
    <div className="space-y-2 rounded border p-3">
      <h4 className="text-sm font-semibold">
        {alvo.tipo === "item" ? "Ficha técnica (insumos por prato)" : "Insumos desta opção"}
      </h4>

      {linhas.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {alvo.tipo === "item"
            ? "Sem ficha: este prato não baixa insumos do estoque."
            : "Sem insumos: esta opção não baixa estoque."}
        </p>
      )}

      <ul className="space-y-1">
        {linhas.map((l) => {
          const p = produtosPorId.get(l.produto_id);
          const unit = custos.get(l.produto_id) ?? 0;
          return (
            <li
              key={l.id}
              className="grid grid-cols-[1fr_5.5rem_4.5rem_auto] items-center gap-2 text-sm"
            >
              <span>
                {p?.descricao ?? "Insumo"}
                <span className="block text-xs text-muted-foreground">
                  {unit > 0 ? `${brl(unit)} por ${p?.unidade ?? "un"}` : "sem custo cadastrado"}
                  {" · consome "}
                  {texto(consumoReal(Number(l.quantidade), Number(l.perda_percentual)))}{" "}
                  {p?.unidade ?? "un"}
                </span>
              </span>
              <Input
                aria-label={`Quantidade de ${p?.descricao ?? "insumo"} (${p?.unidade ?? "un"})`}
                className="h-8 text-right"
                inputMode="decimal"
                defaultValue={texto(Number(l.quantidade))}
                onBlur={(e) => {
                  const q = paraNumero(e.target.value);
                  if (q > 0 && q !== Number(l.quantidade))
                    alterar.mutate({ id: l.id, dados: { quantidade: q } });
                  else e.target.value = texto(Number(l.quantidade));
                }}
              />
              <Input
                aria-label={`Perda de ${p?.descricao ?? "insumo"} (%)`}
                className="h-8 text-right"
                inputMode="decimal"
                title="Perda de preparo (%)"
                defaultValue={texto(Number(l.perda_percentual))}
                onBlur={(e) => {
                  const v = paraNumero(e.target.value);
                  if (v >= 0 && v < 90 && v !== Number(l.perda_percentual))
                    alterar.mutate({ id: l.id, dados: { perda_percentual: v } });
                  else e.target.value = texto(Number(l.perda_percentual));
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remover ${p?.descricao ?? "insumo"} da ficha`}
                onClick={() => remover.mutate(l.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
      {linhas.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Colunas: quantidade na unidade de estoque do insumo e perda de preparo em %.
        </p>
      )}

      <div className="relative">
        <Input
          placeholder="Buscar insumo para adicionar (nome ou código)"
          aria-label="Buscar insumo"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        {sugestoes.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded border bg-popover shadow">
            {sugestoes.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-secondary"
                  onClick={() => adicionar.mutate(p.id)}
                >
                  <span>
                    {p.descricao}
                    <span className="ml-2 text-xs text-muted-foreground">{p.unidade ?? "un"}</span>
                  </span>
                  <Plus className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {busca.trim().length >= 2 && sugestoes.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Nenhum insumo encontrado. Cadastre o insumo em Produtos (com a unidade de estoque, ex.:
            kg).
          </p>
        )}
      </div>

      {linhas.length > 0 && (
        <div className="border-t pt-2 text-sm">
          <div className="flex justify-between">
            <span>{alvo.tipo === "item" ? "Custo do prato" : "Custo desta opção"}</span>
            <strong>{brl(custo)}</strong>
          </div>
          {margem && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Preço {brl(preco ?? 0)} · lucro {brl(margem.lucro)} · margem{" "}
                {margem.margemPercentual}%
              </span>
              <span
                className={
                  faixaCmv(margem.cmvPercentual) === "bom"
                    ? "font-semibold text-emerald-700"
                    : faixaCmv(margem.cmvPercentual) === "atencao"
                      ? "font-semibold text-amber-700"
                      : "font-semibold text-destructive"
                }
              >
                CMV {margem.cmvPercentual}%
              </span>
            </div>
          )}
          {semCusto && (
            <p className="mt-1 text-xs text-amber-700">
              Algum insumo está sem custo (estoque ou cadastro): o custo do prato fica subestimado.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
