import { useEffect } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { aplicarCorEmpresa } from "@/components/app/MarcaEmpresa";
import { Button } from "@/components/ui/button";
import { buscarCardapioPublico } from "@/lib/cardapio-publico.functions";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/menu/$empresa")({
  loader: async ({ params }) => {
    const cardapio = await buscarCardapioPublico({ data: { slug: params.empresa } });
    if (!cardapio) throw notFound();
    return cardapio;
  },
  head: ({ loaderData }) => {
    const nome = loaderData?.empresa.nome;
    const titulo = nome ? `Cardápio — ${nome}` : "Cardápio não encontrado";
    const desc = nome ? `Veja o cardápio de ${nome}.` : "Cardápio não encontrado.";
    return {
      meta: [
        { title: titulo },
        { name: "description", content: desc },
        { property: "og:title", content: titulo },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  notFoundComponent: NaoEncontrado,
  component: CardapioOnline,
});

function NaoEncontrado() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="font-display text-2xl font-bold">Cardápio indisponível</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Este cardápio não existe ou não está publicado no momento.
        </p>
        <Button asChild className="mt-6" variant="outline">
          <Link to="/">Voltar ao início</Link>
        </Button>
      </div>
    </div>
  );
}

function CardapioOnline() {
  const { empresa, categorias } = Route.useLoaderData();

  useEffect(() => {
    aplicarCorEmpresa(empresa.cor);
  }, [empresa.cor]);

  const vazio = categorias.every((c) => c.itens.length === 0);

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 pb-12">
      <header className="flex items-center gap-3 py-6">
        {empresa.logoUrl && (
          <img src={empresa.logoUrl} alt="" className="size-14 rounded-lg object-contain" />
        )}
        <div>
          <h1 className="font-display text-2xl font-bold">{empresa.nome}</h1>
          <p className="text-sm text-muted-foreground">Cardápio</p>
        </div>
      </header>

      {vazio && <p className="py-8 text-center text-muted-foreground">Cardápio em atualização.</p>}

      {categorias.map((c) => (
        <section key={c.nome} className="mb-8">
          <h2 className="mb-3 border-b pb-1 font-display text-lg font-semibold">{c.nome}</h2>
          <ul className="space-y-4">
            {c.itens.map((i) => (
              <li key={i.nome} className="flex gap-3">
                {i.fotoUrl && (
                  <img
                    src={i.fotoUrl}
                    alt={i.nome}
                    loading="lazy"
                    className="size-24 shrink-0 rounded-lg object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-medium">{i.nome}</h3>
                    <span className="shrink-0 font-semibold">{brl(i.preco)}</span>
                  </div>
                  {i.descricao && <p className="text-sm text-muted-foreground">{i.descricao}</p>}
                  {i.grupos
                    .filter((g) => g.opcoes.length > 0)
                    .map((g) => (
                      <p key={g.nome} className="mt-1 text-xs text-muted-foreground">
                        <strong>{g.nome}</strong>
                        {g.obrigatorio ? " (escolha)" : ""}:{" "}
                        {g.opcoes
                          .map(
                            (o) =>
                              `${o.nome}${o.preco_adicional > 0 ? ` +${brl(o.preco_adicional)}` : ""}`,
                          )
                          .join(" · ")}
                      </p>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <footer className="border-t pt-4 text-center text-xs text-muted-foreground">
        Cardápio somente para consulta. Preços sujeitos a alteração.
      </footer>
    </div>
  );
}
