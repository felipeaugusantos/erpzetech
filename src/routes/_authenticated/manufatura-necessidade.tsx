import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageSearch, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { ManufaturaBloqueada } from "@/components/app/ManufaturaBloqueada";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useManufatura } from "@/hooks/useManufatura";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import {
  PERFIS_NECESSIDADE,
  agruparParaCompra,
  chaveDeCompra,
  formatarQuantidadeMf,
  valorEstimadoDaCompra,
} from "@/lib/manufatura";

export const Route = createFileRoute("/_authenticated/manufatura-necessidade")({
  head: () => ({
    meta: [
      { title: "Necessidade de materiais — EZRA ERP" },
      {
        name: "description",
        content:
          "O que as ordens de produção ainda precisam, o saldo livre, o que já está pedido e o que falta comprar, com pedido de compra em rascunho.",
      },
    ],
  }),
  component: NecessidadeModulo,
});

function NecessidadeModulo() {
  const m = useManufatura();
  if (m.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!m.liberada) return <ManufaturaBloqueada motivo="modulo" />;
  if (!m.temPerfil(PERFIS_NECESSIDADE)) return <ManufaturaBloqueada motivo="perfil" />;
  return <Necessidade />;
}

const chaveLinha = (l: { insumo_id: string; deposito_id: string }) =>
  `${l.insumo_id}|${l.deposito_id}`;
const numero = (t: string) => Number((t || "0").replace(",", "."));

function Necessidade() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mostrarCobertos, setMostrarCobertos] = useState(false);
  const [qtd, setQtd] = useState<Record<string, string>>({});
  const [marcado, setMarcado] = useState<Record<string, boolean>>({});

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["mf-necessidade"],
    queryFn: async () => {
      const [nec, forn] = await Promise.all([
        supabase.rpc("mf_necessidade"),
        supabase.from("fornecedores").select("id, razao_social"),
      ]);
      if (nec.error) throw nec.error;
      if (forn.error) throw forn.error;
      return { linhas: nec.data ?? [], fornecedores: forn.data ?? [] };
    },
  });

  const nomeFornecedor = (id: string | null) =>
    id
      ? (data?.fornecedores.find((f) => f.id === id)?.razao_social ?? "Fornecedor")
      : "Sem fornecedor definido";
  const quantidadeDe = (l: { insumo_id: string; deposito_id: string; falta: number }) => {
    const v = qtd[chaveLinha(l)];
    return v === undefined ? Number(l.falta) : numero(v);
  };
  const marcadoDe = (l: { insumo_id: string; deposito_id: string }) =>
    marcado[chaveLinha(l)] ?? true;

  const emFalta = useMemo(() => (data?.linhas ?? []).filter((l) => Number(l.falta) > 0), [data]);
  const cobertos = useMemo(
    () => (data?.linhas ?? []).filter((l) => !(Number(l.falta) > 0)),
    [data],
  );
  const grupos = useMemo(
    () => [...agruparParaCompra(emFalta.map((l) => ({ ...l, falta: Number(l.falta) }))).entries()],
    [emFalta],
  );
  const valorTotal = emFalta.reduce(
    (s, l) => s + valorEstimadoDaCompra(Number(l.falta), Number(l.custo_unitario)),
    0,
  );

  const criar = useMutation({
    mutationFn: async (linhas: (typeof emFalta)[number][]) => {
      const itens = linhas
        .filter(marcadoDe)
        .map((l) => ({ produto_id: l.insumo_id, quantidade: quantidadeDe(l) }))
        .filter((x) => x.quantidade > 0);
      if (itens.length === 0) throw new Error("Marque ao menos um insumo com quantidade.");
      const ordens = [...new Set(linhas.flatMap((l) => l.ordens ?? []))].join(", ");
      const primeira = linhas[0];
      if (!primeira) throw new Error("Nada a comprar neste grupo.");
      const { data: id, error } = await supabase.rpc("compra_criar_de_sugestao", {
        p_deposito_id: primeira.deposito_id,
        p_fornecedor_id: (primeira.fornecedor_id ?? null) as never,
        p_itens: itens as never,
        p_observacao: `Necessidade de materiais da manufatura (${ordens})`,
      });
      if (error) throw error;
      return id as string;
    },
    onSuccess: (id) => {
      toast.success("Pedido de compra criado em rascunho para conferência.");
      void qc.invalidateQueries({ queryKey: ["mf-necessidade"] });
      void qc.invalidateQueries({ queryKey: ["compras"] });
      void navigate({ to: "/compras/$id", params: { id } });
    },
    onError: (e: Error) =>
      toast.error("Não foi possível criar a compra", { description: e.message }),
  });

  return (
    <div>
      <PageHeader
        title="Necessidade de materiais"
        description="O que as ordens ainda precisam e não estão reservadas, menos o saldo livre e o que já está pedido. Nada é comprado: o pedido sai em rascunho para conferência."
        actions={
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={mostrarCobertos}
              onCheckedChange={setMostrarCobertos}
              aria-label="Mostrar insumos cobertos"
            />
            Mostrar cobertos
          </label>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Insumos em falta" value={String(emFalta.length)} icon={PackageSearch} />
        <StatCard
          label="Valor estimado da compra"
          value={brl(valorTotal)}
          hint="Pelo custo de referência"
          icon={ShoppingCart}
        />
        <StatCard
          label="Já cobertos"
          value={String(cobertos.length)}
          hint="Saldo livre ou pedido aberto"
        />
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : isError ? (
        // uma falha nunca vira "nada em falta": o comprador veria cobertura onde não há informação
        <div className="panel mx-auto max-w-2xl p-6 text-center" role="alert">
          <p className="font-display text-base font-semibold">
            Não foi possível calcular a necessidade
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {(error as Error | null)?.message ?? "Erro ao consultar os dados."} Se o problema
            continuar, confirme com a equipe que a atualização do banco da manufatura foi aplicada.
          </p>
          <Button className="mt-4" onClick={() => void refetch()} disabled={isFetching}>
            Tentar de novo
          </Button>
        </div>
      ) : emFalta.length === 0 && (!mostrarCobertos || cobertos.length === 0) ? (
        <EmptyState
          title="Nenhum insumo em falta"
          description="As ordens planejadas estão cobertas pelo saldo livre ou pelos pedidos de compra abertos."
        />
      ) : (
        <div className="space-y-4">
          {grupos.map(([chave, linhas]) => (
            <div key={chave} className="panel overflow-x-auto">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
                <div>
                  <p className="font-display text-base font-semibold">
                    {nomeFornecedor(linhas[0]?.fornecedor_id ?? null)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Depósito: {emFalta.find((x) => chaveDeCompra(x) === chave)?.deposito ?? ""}
                  </p>
                </div>
                <Button
                  onClick={() => criar.mutate(emFalta.filter((x) => chaveDeCompra(x) === chave))}
                  disabled={criar.isPending}
                >
                  <ShoppingCart className="mr-2 size-4" /> Criar pedido de compra (rascunho)
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Insumo</TableHead>
                    <TableHead className="text-right">Necessário</TableHead>
                    <TableHead className="text-right">Livre</TableHead>
                    <TableHead className="text-right">Já pedido</TableHead>
                    <TableHead className="text-right">Falta</TableHead>
                    <TableHead className="w-28 text-right">Comprar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emFalta
                    .filter((x) => chaveDeCompra(x) === chave)
                    .map((l) => (
                      <TableRow key={chaveLinha(l)}>
                        <TableCell>
                          <Checkbox
                            checked={marcadoDe(l)}
                            onCheckedChange={(v) =>
                              setMarcado({ ...marcado, [chaveLinha(l)]: v === true })
                            }
                            aria-label={`Comprar ${l.descricao}`}
                          />
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{l.descricao}</p>
                          <p className="text-xs text-muted-foreground">
                            {(l.ordens ?? []).join(", ")}
                          </p>
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {formatarQuantidadeMf(Number(l.necessario))} {l.unidade}
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {formatarQuantidadeMf(Number(l.disponivel))}
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {formatarQuantidadeMf(Number(l.em_compra))}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="destructive" className="text-numeric">
                            {formatarQuantidadeMf(Number(l.falta))}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            inputMode="decimal"
                            aria-label={`Quantidade a comprar de ${l.descricao}`}
                            className="h-8 text-right"
                            value={qtd[chaveLinha(l)] ?? String(l.falta)}
                            onChange={(e) => setQtd({ ...qtd, [chaveLinha(l)]: e.target.value })}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          ))}

          {mostrarCobertos && cobertos.length > 0 && (
            <div className="panel overflow-x-auto">
              <p className="border-b border-border p-4 font-display text-base font-semibold">
                Insumos cobertos
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Insumo</TableHead>
                    <TableHead className="text-right">Necessário</TableHead>
                    <TableHead className="text-right">Livre</TableHead>
                    <TableHead className="text-right">Já pedido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cobertos.map((l) => (
                    <TableRow key={chaveLinha(l)}>
                      <TableCell>
                        <p className="font-medium">{l.descricao}</p>
                        <p className="text-xs text-muted-foreground">
                          {(l.ordens ?? []).join(", ")} · {l.deposito}
                        </p>
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {formatarQuantidadeMf(Number(l.necessario))} {l.unidade}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {formatarQuantidadeMf(Number(l.disponivel))}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {formatarQuantidadeMf(Number(l.em_compra))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
