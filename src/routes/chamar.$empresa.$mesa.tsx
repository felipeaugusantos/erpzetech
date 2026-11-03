import { useEffect, useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { BellRing, Check } from "lucide-react";

import { aplicarCorEmpresa } from "@/components/app/MarcaEmpresa";
import { Button } from "@/components/ui/button";
import { buscarInfoChamado, chamarGarcom } from "@/lib/chamar-garcom.functions";

export const Route = createFileRoute("/chamar/$empresa/$mesa")({
  loader: async ({ params }) => {
    const info = await buscarInfoChamado({ data: { slug: params.empresa, mesa: params.mesa } });
    if (!info) throw notFound();
    return info;
  },
  head: ({ loaderData }) => {
    const titulo = loaderData
      ? `Chamar o garçom — ${loaderData.empresa.nome}`
      : "Chamado indisponível";
    return {
      meta: [
        { title: titulo },
        { name: "description", content: "Chame o garçom da sua mesa." },
        { name: "robots", content: "noindex" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center p-6 text-center">
      <div className="max-w-sm">
        <h1 className="font-display text-2xl font-bold">Chamado indisponível</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Este QR code não está ativo. Chame o garçom pessoalmente.
        </p>
      </div>
    </div>
  ),
  component: ChamarGarcom,
});

function ChamarGarcom() {
  const info = Route.useLoaderData();
  const { empresa, mesa } = Route.useParams();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [feitos, setFeitos] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    aplicarCorEmpresa(info.empresa.cor);
  }, [info.empresa.cor]);

  // sem motivos cadastrados, vale o chamado simples
  const opcoes = info.motivos.length > 0 ? info.motivos : [{ id: "", nome: "Chamar garçom" }];

  async function chamar(id: string, nome: string) {
    setEnviando(id);
    setErro(null);
    try {
      const r = await chamarGarcom({ data: { slug: empresa, mesa, motivo: id || null } });
      if (r.ok) setFeitos((f) => [...f, nome]);
      else setErro(r.erro ?? "Não foi possível chamar. Chame o garçom pessoalmente.");
    } catch {
      setErro("Não foi possível chamar. Chame o garçom pessoalmente.");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 py-8 text-center">
      <p className="text-sm uppercase tracking-wide text-muted-foreground">{info.empresa.nome}</p>
      <h1 className="mt-1 font-display text-3xl font-bold">Mesa {info.mesa}</h1>
      <p className="mt-2 text-muted-foreground">Como podemos ajudar?</p>

      <div className="mt-8 space-y-3">
        {opcoes.map((o) => {
          const feito = feitos.includes(o.nome);
          return (
            <Button
              key={o.id || "simples"}
              size="lg"
              variant={feito ? "secondary" : "default"}
              className="h-16 w-full text-lg"
              disabled={enviando !== null || feito}
              onClick={() => void chamar(o.id, o.nome)}
            >
              {feito ? (
                <>
                  <Check className="mr-2 size-5" /> {o.nome}: avisado
                </>
              ) : (
                <>
                  <BellRing className="mr-2 size-5" /> {o.nome}
                </>
              )}
            </Button>
          );
        })}
      </div>

      {feitos.length > 0 && (
        <p role="status" className="mt-6 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          Pronto! A equipe já foi avisada e logo chega até você.
        </p>
      )}
      {erro && (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {erro}
        </p>
      )}
    </div>
  );
}
