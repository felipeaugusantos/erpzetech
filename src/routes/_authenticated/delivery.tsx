import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, Plus } from "lucide-react";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { ComandaDialog } from "@/components/restaurante/ComandaDialog";
import { NovoDeliveryDialog } from "@/components/restaurante/NovoDeliveryDialog";
import { Button } from "@/components/ui/button";
import { useRealtimeTabelas } from "@/hooks/useRealtimeTabelas";
import { useRelogio } from "@/hooks/useRelogio";
import { useSessionData } from "@/hooks/useSessionData";
import { useModulosCnae } from "@/lib/cnae";
import { ROTULO_ETAPA, etapaDelivery, formatarEndereco, type EtapaDelivery } from "@/lib/delivery";
import { brl } from "@/lib/format";
import { minutosDesde } from "@/lib/restaurante";
import {
  CHAVE_REST,
  tabela,
  type Comanda,
  type ComandaItem,
  type Mesa,
} from "@/lib/restaurante-dados";

export const Route = createFileRoute("/_authenticated/delivery")({
  head: () => ({
    meta: [
      { title: "Delivery — ERP Ze Tech" },
      { name: "description", content: "Pedidos de entrega do restaurante." },
    ],
  }),
  component: Delivery,
});

const PERFIS_DELIVERY = ["administrador", "gestor", "garcom", "caixa"];
const COLUNAS: EtapaDelivery[] = ["montando", "cozinha", "pronto", "em_rota", "entregue"];
const SEM_MESAS: Mesa[] = [];

type ItemResumo = Pick<ComandaItem, "comanda_id" | "cardapio_item_id" | "situacao" | "total">;

function Delivery() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const modulos = useModulosCnae();
  const roles = session?.roles ?? [];
  const agora = useRelogio();
  const [novo, setNovo] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);

  useRealtimeTabelas(["comandas", "comanda_itens"], () =>
    qc.invalidateQueries({ queryKey: [CHAVE_REST] }),
  );

  const { data, isLoading } = useQuery({
    queryKey: [CHAVE_REST, "delivery"],
    enabled: modulos.restaurante,
    queryFn: async () => {
      // abertos, mais o que foi entregue hoje
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const [abertos, recentes, taxa] = await Promise.all([
        tabela("comandas").select("*").eq("tipo", "delivery").eq("situacao", "aberta"),
        tabela("comandas")
          .select("*")
          .eq("tipo", "delivery")
          .neq("situacao", "aberta")
          .gte("aberta_em", hoje.toISOString()),
        tabela("cardapio_itens")
          .select("id")
          .eq("interno", true)
          .eq("nome", "Taxa de entrega")
          .maybeSingle(),
      ]);
      for (const r of [abertos, recentes, taxa]) if (r.error) throw new Error(r.error.message);
      const comandas = [
        ...((abertos.data ?? []) as unknown as Comanda[]),
        ...((recentes.data ?? []) as unknown as Comanda[]),
      ].filter((c) => c.situacao !== "cancelada");
      let itens: ItemResumo[] = [];
      if (comandas.length > 0) {
        const r = await tabela("comanda_itens")
          .select("comanda_id, cardapio_item_id, situacao, total")
          .in(
            "comanda_id",
            comandas.map((c) => c.id),
          );
        if (r.error) throw new Error(r.error.message);
        itens = (r.data ?? []) as unknown as ItemResumo[];
      }
      return {
        comandas,
        itens,
        taxaItemId: (taxa.data as unknown as { id: string } | null)?.id ?? null,
      };
    },
  });

  const cartoes = useMemo(() => {
    const porColuna = new Map<EtapaDelivery, { c: Comanda; total: number }[]>();
    for (const c of data?.comandas ?? []) {
      const meus = (data?.itens ?? []).filter((i) => i.comanda_id === c.id);
      const comida = meus.filter((i) => i.cardapio_item_id !== data?.taxaItemId);
      const etapa = etapaDelivery(
        c.entrega_situacao,
        comida.map((i) => i.situacao),
      );
      const total = meus
        .filter((i) => i.situacao !== "cancelado")
        .reduce((s, i) => s + Number(i.total), 0);
      porColuna.set(etapa, [...(porColuna.get(etapa) ?? []), { c, total }]);
    }
    for (const lista of porColuna.values())
      lista.sort((a, b) => a.c.aberta_em.localeCompare(b.c.aberta_em));
    return porColuna;
  }, [data]);

  if (session && !modulos.carregando && !modulos.restaurante)
    return <ModuloBloqueado modulo="restaurante" />;
  if (session && !roles.some((r) => PERFIS_DELIVERY.includes(r)))
    return (
      <EmptyState
        title="Sem acesso ao delivery"
        description="Seu perfil não atende pedidos de entrega. Fale com a gestão."
      />
    );

  return (
    <>
      <PageHeader
        title="Delivery"
        description="Pedidos de entrega do restaurante, da montagem até o cliente."
        actions={
          <Button onClick={() => setNovo(true)}>
            <Plus className="mr-1 size-4" /> Novo pedido
          </Button>
        }
      />

      {isLoading && <p className="text-sm text-muted-foreground">Carregando pedidos...</p>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {COLUNAS.map((etapa) => {
          const lista = cartoes.get(etapa) ?? [];
          return (
            <section key={etapa} className="rounded-xl border bg-muted/30 p-2">
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                {ROTULO_ETAPA[etapa]}
                <span className="rounded-full bg-background px-2 text-xs">{lista.length}</span>
              </h2>
              <div className="space-y-2">
                {lista.map(({ c, total }) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setAberta(c.id)}
                    className={`w-full rounded-lg border bg-background p-2 text-left text-sm hover:shadow-md ${
                      etapa === "pronto" ? "border-emerald-500 ring-1 ring-emerald-400" : ""
                    }`}
                  >
                    <span className="flex items-center justify-between">
                      <span className="font-display font-bold">Nº {c.numero}</span>
                      <span className="font-medium">{brl(total)}</span>
                    </span>
                    <span className="block">{c.cliente_nome ?? "Cliente"}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatarEndereco({
                        endereco: c.entrega_endereco,
                        bairro: c.entrega_bairro,
                      })}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {c.canal === "ifood" ? "iFood · " : ""}há {minutosDesde(c.aberta_em, agora)}{" "}
                      min
                      {c.entregador ? ` · ${c.entregador}` : ""}
                    </span>
                  </button>
                ))}
                {lista.length === 0 && (
                  <p className="px-1 py-3 text-center text-xs text-muted-foreground">Nenhum</p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {!isLoading && (data?.comandas.length ?? 0) === 0 && (
        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Bike className="size-4" /> Nenhum pedido de delivery hoje.
        </p>
      )}

      {novo && (
        <NovoDeliveryDialog
          onFechar={() => setNovo(false)}
          onCriado={(id) => {
            setNovo(false);
            setAberta(id);
          }}
        />
      )}

      {aberta && (
        <ComandaDialog
          comandaId={aberta}
          roles={roles}
          mesas={SEM_MESAS}
          mesasLivres={SEM_MESAS}
          onFechar={() => setAberta(null)}
        />
      )}
    </>
  );
}
