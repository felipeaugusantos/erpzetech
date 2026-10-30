import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";

import { ManufaturaBloqueada } from "@/components/app/ManufaturaBloqueada";
import { PageHeader, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useManufatura } from "@/hooks/useManufatura";
import { PERFIS_APONTAMENTO } from "@/lib/manufatura";
import { erroDaChapa, perdaDoPlano, planoDeCorte, type PecaCorte } from "@/lib/plano-corte";

export const Route = createFileRoute("/_authenticated/manufatura-corte")({
  head: () => ({
    meta: [
      { title: "Plano de corte — EZRA ERP" },
      {
        name: "description",
        content:
          "Distribua as peças nas chapas, veja quantas chapas comprar, o aproveitamento e o desenho do corte.",
      },
    ],
  }),
  component: CorteModulo,
});

function CorteModulo() {
  const m = useManufatura();
  if (m.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!m.liberada) return <ManufaturaBloqueada motivo="modulo" />;
  if (!m.temPerfil(PERFIS_APONTAMENTO)) return <ManufaturaBloqueada motivo="perfil" />;
  return <Corte />;
}

type LinhaPeca = {
  nome: string;
  largura: string;
  altura: string;
  quantidade: string;
  girar: boolean;
};

const numero = (t: string) => Number((t || "0").replace(",", "."));
const nova = (): LinhaPeca => ({ nome: "", largura: "", altura: "", quantidade: "1", girar: true });

function Corte() {
  const [chapa, setChapa] = useState({ largura: "2750", altura: "1850", refilo: "10", serra: "3" });
  const [linhas, setLinhas] = useState<LinhaPeca[]>([nova()]);

  const dadosChapa = {
    largura: numero(chapa.largura),
    altura: numero(chapa.altura),
    refilo: numero(chapa.refilo),
    serra: numero(chapa.serra),
  };
  const erro = erroDaChapa(dadosChapa);
  const plano = useMemo(() => {
    if (erro) return null;
    const pecas: PecaCorte[] = linhas.map((l, i) => ({
      nome: l.nome.trim() || `Peça ${i + 1}`,
      largura: numero(l.largura),
      altura: numero(l.altura),
      quantidade: Math.floor(numero(l.quantidade)),
      girar: l.girar,
    }));
    return planoDeCorte(pecas, dadosChapa);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, chapa.largura, chapa.altura, chapa.refilo, chapa.serra, erro]);

  const mudar = (i: number, campo: Partial<LinhaPeca>) =>
    setLinhas(linhas.map((l, j) => (j === i ? { ...l, ...campo } : l)));

  return (
    <div>
      <PageHeader
        title="Plano de corte"
        description="Informe a chapa e as peças: o plano mostra quantas chapas usar, o aproveitamento e o desenho de cada uma."
      />

      <div className="panel mb-4 grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ["largura", "Largura da chapa (mm)"],
            ["altura", "Altura da chapa (mm)"],
            ["refilo", "Refilo em volta (mm)"],
            ["serra", "Espessura da serra (mm)"],
          ] as const
        ).map(([campo, rotulo]) => (
          <div key={campo} className="grid gap-1.5">
            <Label htmlFor={`ch-${campo}`}>{rotulo}</Label>
            <Input
              id={`ch-${campo}`}
              inputMode="decimal"
              value={chapa[campo]}
              onChange={(e) => setChapa({ ...chapa, [campo]: e.target.value })}
            />
          </div>
        ))}
        {erro && <p className="text-sm text-destructive sm:col-span-2 xl:col-span-4">{erro}</p>}
      </div>

      <div className="panel mb-4 p-4">
        <p className="mb-2 text-sm font-medium">Peças (medidas em mm)</p>
        <div className="grid gap-2">
          {linhas.map((l, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_5.5rem_5.5rem_4.5rem_auto_auto] items-center gap-2 max-sm:grid-cols-2"
            >
              <Input
                aria-label={`Nome da peça ${i + 1}`}
                placeholder="Peça (ex.: lateral)"
                value={l.nome}
                onChange={(e) => mudar(i, { nome: e.target.value })}
                className="max-sm:col-span-2"
              />
              <Input
                aria-label={`Largura ${i + 1}`}
                inputMode="decimal"
                placeholder="Largura"
                value={l.largura}
                onChange={(e) => mudar(i, { largura: e.target.value })}
              />
              <Input
                aria-label={`Altura ${i + 1}`}
                inputMode="decimal"
                placeholder="Altura"
                value={l.altura}
                onChange={(e) => mudar(i, { altura: e.target.value })}
              />
              <Input
                aria-label={`Quantidade ${i + 1}`}
                inputMode="numeric"
                placeholder="Qtd."
                value={l.quantidade}
                onChange={(e) => mudar(i, { quantidade: e.target.value })}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={l.girar}
                  onCheckedChange={(v) => mudar(i, { girar: v === true })}
                  aria-label={`Pode girar a peça ${i + 1}`}
                />
                Pode girar
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover peça ${i + 1}`}
                onClick={() =>
                  setLinhas(linhas.length > 1 ? linhas.filter((_, j) => j !== i) : [nova()])
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setLinhas([...linhas, nova()])}
        >
          <Plus className="mr-1.5 size-3.5" /> Adicionar peça
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Desmarque &quot;Pode girar&quot; nas peças em que o veio da madeira precisa seguir o
          comprimento da chapa.
        </p>
      </div>

      {plano && plano.chapas.length > 0 && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard label="Chapas necessárias" value={String(plano.chapas.length)} />
            <StatCard
              label="Aproveitamento"
              value={`${plano.aproveitamento.toLocaleString("pt-BR")}%`}
            />
            <StatCard
              label="Perda para a lista de materiais"
              value={`${perdaDoPlano(plano.aproveitamento).toLocaleString("pt-BR")}%`}
              hint="Use como perda do item chapa na lista."
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {plano.chapas.map((c, idx) => (
              <div key={idx} className="panel p-3">
                <p className="mb-2 text-sm font-medium">
                  Chapa {idx + 1} · {c.pecas.length} peça{c.pecas.length === 1 ? "" : "s"}
                </p>
                <svg
                  viewBox={`0 0 ${dadosChapa.largura} ${dadosChapa.altura}`}
                  className="w-full rounded border bg-secondary"
                  role="img"
                  aria-label={`Desenho do corte da chapa ${idx + 1}`}
                >
                  {c.pecas.map((p, k) => (
                    <g key={k}>
                      <rect
                        x={p.x}
                        y={p.y}
                        width={p.largura}
                        height={p.altura}
                        className="fill-primary/20 stroke-primary"
                        strokeWidth={Math.max(dadosChapa.largura / 400, 1)}
                      />
                      <text
                        x={p.x + p.largura / 2}
                        y={p.y + p.altura / 2}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={Math.max(
                          Math.min(p.largura, p.altura) / 5,
                          dadosChapa.largura / 90,
                        )}
                        className="fill-foreground"
                      >
                        {p.nome}
                      </text>
                    </g>
                  ))}
                </svg>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {c.pecas
                    .map((p) => `${p.nome} ${p.largura}×${p.altura}${p.girada ? " (girada)" : ""}`)
                    .join(" · ")}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      {plano && plano.naoCabem.length > 0 && (
        <p className="mt-4 text-sm text-destructive">
          Não cabem na chapa: {[...new Set(plano.naoCabem)].join(", ")}. Confira as medidas, o
          refilo ou se a peça pode girar.
        </p>
      )}
    </div>
  );
}
