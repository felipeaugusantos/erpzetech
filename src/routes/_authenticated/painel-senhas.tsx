import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { useRealtimeTabelas } from "@/hooks/useRealtimeTabelas";
import { useSessionData } from "@/hooks/useSessionData";
import { useModulosCnae } from "@/lib/cnae";
import { etapaSenha } from "@/lib/restaurante";
import { CHAVE_REST, tabela, type Comanda, type ComandaItem } from "@/lib/restaurante-dados";

export const Route = createFileRoute("/_authenticated/painel-senhas")({
  head: () => ({
    meta: [
      { title: "Painel de senhas — EZRA ERP" },
      { name: "description", content: "Senhas em preparo e prontas para retirada." },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PainelSenhas,
});

const PERFIS_PAINEL = ["administrador", "gestor", "garcom", "caixa"];

function PainelSenhas() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const modulos = useModulosCnae();
  const roles = session?.roles ?? [];

  useRealtimeTabelas(["comandas", "comanda_itens"], () =>
    qc.invalidateQueries({ queryKey: [CHAVE_REST, "painel-senhas"] }),
  );

  const { data } = useQuery({
    queryKey: [CHAVE_REST, "painel-senhas"],
    enabled: modulos.restaurante,
    // reforço do tempo real: se a conexão do Realtime cair, o painel continua se atualizando
    refetchInterval: 20_000,
    queryFn: async () => {
      const c = await tabela("comandas")
        .select("id, senha, senha_data, numero")
        .eq("situacao", "aberta")
        .not("senha", "is", null);
      if (c.error) throw new Error(c.error.message);
      const comandas = (c.data ?? []) as unknown as Pick<
        Comanda,
        "id" | "senha" | "senha_data" | "numero"
      >[];
      if (comandas.length === 0)
        return { comandas, itens: [] as Pick<ComandaItem, "comanda_id" | "situacao">[] };
      const i = await tabela("comanda_itens")
        .select("comanda_id, situacao")
        .in(
          "comanda_id",
          comandas.map((x) => x.id),
        );
      if (i.error) throw new Error(i.error.message);
      return {
        comandas,
        itens: (i.data ?? []) as unknown as Pick<ComandaItem, "comanda_id" | "situacao">[],
      };
    },
  });

  const { preparo, pronto } = useMemo(() => {
    const preparo: { senha: number; id: string }[] = [];
    const pronto: { senha: number; id: string }[] = [];
    for (const c of data?.comandas ?? []) {
      const etapa = etapaSenha(
        (data?.itens ?? []).filter((i) => i.comanda_id === c.id).map((i) => i.situacao),
      );
      if (etapa === "preparo") preparo.push({ senha: c.senha!, id: c.id });
      if (etapa === "pronto") pronto.push({ senha: c.senha!, id: c.id });
    }
    const porSenha = (a: { senha: number }, b: { senha: number }) => a.senha - b.senha;
    return { preparo: preparo.sort(porSenha), pronto: pronto.sort(porSenha) };
  }, [data]);

  if (session && !modulos.carregando && !modulos.restaurante)
    return <ModuloBloqueado modulo="restaurante" />;
  if (session && !roles.some((r) => PERFIS_PAINEL.includes(r)))
    return (
      <EmptyState
        title="Sem acesso ao painel"
        description="Seu perfil não abre o painel de senhas."
      />
    );

  return (
    <>
      <PageHeader
        title="Painel de senhas"
        description="Deixe esta tela aberta numa TV: mostra o que está em preparo e o que já pode ser retirado."
      />
      <div className="grid min-h-[60vh] gap-4 md:grid-cols-2">
        <section aria-label="Em preparo" className="rounded-2xl border-2 bg-muted/30 p-4">
          <h2 className="mb-4 text-center font-display text-3xl font-bold">Em preparo</h2>
          <ul className="flex flex-wrap justify-center gap-3">
            {preparo.map((s) => (
              <li
                key={s.id}
                className="min-w-24 rounded-xl bg-background px-5 py-3 text-center font-display text-5xl font-bold shadow"
              >
                {s.senha}
              </li>
            ))}
          </ul>
          {preparo.length === 0 && (
            <p className="text-center text-muted-foreground">Nenhum pedido em preparo.</p>
          )}
        </section>
        <section
          aria-label="Prontos para retirar"
          className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4"
        >
          <h2 className="mb-4 text-center font-display text-3xl font-bold text-emerald-800">
            Pronto — retire no balcão
          </h2>
          <ul className="flex flex-wrap justify-center gap-3">
            {pronto.map((s) => (
              <li
                key={s.id}
                className="min-w-24 rounded-xl bg-emerald-600 px-5 py-3 text-center font-display text-6xl font-bold text-white shadow"
              >
                {s.senha}
              </li>
            ))}
          </ul>
          {pronto.length === 0 && (
            <p className="text-center text-muted-foreground">Nenhum pedido pronto.</p>
          )}
        </section>
      </div>
    </>
  );
}
