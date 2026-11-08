import { cn } from "@/lib/utils";
import { contagemPorLocal, locaisForaDoCroqui, zonasDoCroqui } from "@/lib/lava-croqui";

type Forma =
  | { t: "rect"; x: number; y: number; w: number; h: number; r?: number }
  | { t: "path"; d: string }
  | { t: "circle"; cx: number; cy: number; r: number };

/** Formas de cada local, vistas de cima, com a frente do carro para cima. Os nomes são os mesmos de locaisDeAvaria. */
const FORMAS: Record<string, Forma[]> = {
  Frente: [{ t: "rect", x: 52, y: 12, w: 96, h: 30, r: 14 }],
  Capô: [{ t: "path", d: "M52 46 H148 L142 112 H58 Z" }],
  "Para-brisa": [{ t: "path", d: "M58 116 H142 L134 146 H66 Z" }],
  Teto: [{ t: "rect", x: 66, y: 150, w: 68, h: 66, r: 6 }],
  "Porta-malas": [{ t: "path", d: "M66 252 H134 L142 308 H58 Z" }],
  Caçamba: [{ t: "path", d: "M62 232 H138 L142 310 H58 Z" }],
  Traseira: [{ t: "rect", x: 52, y: 314, w: 96, h: 30, r: 14 }],
  "Lateral esquerda": [{ t: "rect", x: 24, y: 70, w: 24, h: 230, r: 10 }],
  "Lateral direita": [{ t: "rect", x: 152, y: 70, w: 24, h: 230, r: 10 }],
  Rodas: [
    { t: "circle", cx: 28, cy: 96, r: 13 },
    { t: "circle", cx: 172, cy: 96, r: 13 },
    { t: "circle", cx: 28, cy: 270, r: 13 },
    { t: "circle", cx: 172, cy: 270, r: 13 },
  ],
};

/** Ponto onde fica o número de avarias de cada local. */
const ROTULO: Record<string, [number, number]> = {
  Frente: [100, 32],
  Capô: [100, 84],
  "Para-brisa": [100, 136],
  Teto: [100, 188],
  "Porta-malas": [100, 284],
  Caçamba: [100, 272],
  Traseira: [100, 334],
  "Lateral esquerda": [36, 190],
  "Lateral direita": [164, 190],
  Rodas: [28, 270],
};

function Forma({ f }: { f: Forma }) {
  if (f.t === "rect")
    return <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={f.r ?? 0} />;
  if (f.t === "circle") return <circle cx={f.cx} cy={f.cy} r={f.r} />;
  return <path d={f.d} />;
}

/**
 * Croqui do veículo visto de cima: tocar numa parte preenche o local da avaria.
 * Só desenha o que existe para o tipo de veículo; os demais locais ficam como botões embaixo.
 */
export function CroquiVeiculo({
  tipo,
  selecionado,
  onEscolher,
  avarias,
  desabilitado,
}: {
  tipo: string;
  selecionado: string;
  onEscolher: (local: string) => void;
  avarias: { lugar: string }[];
  desabilitado?: boolean;
}) {
  const zonas = zonasDoCroqui(tipo);
  if (zonas.length === 0) return null;
  const contagem = contagemPorLocal(avarias);
  const alvo = selecionado.trim().toLowerCase();
  const fora = locaisForaDoCroqui(tipo);

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        Toque na parte do veículo onde está a avaria (frente para cima).
      </p>
      <svg
        viewBox="0 0 200 356"
        role="group"
        aria-label="Croqui do veículo visto de cima"
        className="mx-auto h-64 w-auto"
      >
        {zonas.map((z) => {
          const ativo = alvo === z.toLowerCase();
          const n = contagem.get(z.toLowerCase()) ?? 0;
          const [lx, ly] = ROTULO[z] ?? [100, 180];
          return (
            <g
              key={z}
              role="button"
              tabIndex={desabilitado ? -1 : 0}
              aria-label={`${z}${n ? `, ${n} registrada${n > 1 ? "s" : ""}` : ""}`}
              aria-pressed={ativo}
              onClick={() => !desabilitado && onEscolher(z)}
              onKeyDown={(e) => {
                if (!desabilitado && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onEscolher(z);
                }
              }}
              className={cn(
                "cursor-pointer outline-none [&>*]:transition-colors [&>*]:stroke-foreground/40 [&>*]:stroke-1",
                z === "Rodas" ? "[&>*]:fill-foreground/70" : "[&>*]:fill-muted",
                !desabilitado && "hover:[&>*]:fill-primary/30 focus-visible:[&>*]:stroke-primary",
                n > 0 && z !== "Rodas" && "[&>*]:fill-destructive/20",
                ativo && "[&>*]:fill-primary/40 [&>*]:stroke-primary [&>*]:stroke-2",
                desabilitado && "cursor-default",
              )}
            >
              {FORMAS[z]?.map((f, i) => <Forma key={i} f={f} />)}
              {n > 0 && (
                <g className="pointer-events-none">
                  <circle cx={lx} cy={ly} r={9} className="fill-destructive" />
                  <text
                    x={lx}
                    y={ly + 4}
                    textAnchor="middle"
                    className="fill-destructive-foreground text-[11px] font-semibold"
                  >
                    {n}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {fora.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {fora.map((l) => {
            const n = contagem.get(l.toLowerCase()) ?? 0;
            return (
              <button
                key={l}
                type="button"
                disabled={desabilitado}
                aria-pressed={alvo === l.toLowerCase()}
                onClick={() => onEscolher(l)}
                className={cn(
                  "rounded-md border px-3 py-1 text-xs",
                  alvo === l.toLowerCase() && "border-primary bg-primary/10",
                  n > 0 && "border-destructive/60",
                )}
              >
                {l}
                {n > 0 ? ` (${n})` : ""}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
