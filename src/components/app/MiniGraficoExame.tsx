import { formatarNumero, type PontoEvolucao } from "@/lib/exames";
import { dateBR } from "@/lib/format";

export function MiniGraficoExame({ nome, unidade, pontos }: {
  nome: string;
  unidade: string | null;
  pontos: PontoEvolucao[];
}) {
  if (pontos.length < 2) return null;
  const min = Math.min(...pontos.map(p => p.valor));
  const max = Math.max(...pontos.map(p => p.valor));
  const coords = pontos.map((p, i) => ({
    x: 35 + i * 250 / (pontos.length - 1),
    y: max === min ? 42 : 62 - (p.valor - min) / (max - min) * 40,
  }));
  return (
    <figure className="min-w-0 break-inside-avoid text-foreground">
      <figcaption className="text-xs font-medium">{nome}{unidade ? ` (${unidade})` : ""}</figcaption>
      <svg viewBox="0 0 320 86" className="block h-24 w-full" role="img" aria-label={`Evolução de ${nome}`}>
        <path d="M35 70 H285" fill="none" stroke="currentColor" strokeOpacity="0.25" />
        <polyline points={coords.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" />
        {pontos.map((p, i) => {
          const coord = coords[i];
          if (!coord) return null;
          return <g key={p.exame_id}>
            <circle cx={coord.x} cy={coord.y} r={i === pontos.length - 1 ? 3.5 : 2.5} fill="currentColor" />
            <text x={coord.x} y={coord.y - 8} textAnchor="middle" fontSize="10" fill="currentColor">{formatarNumero(p.valor, p.casas)}</text>
            <text x={coord.x} y="83" textAnchor="middle" fontSize="9" fill="currentColor">{dateBR(p.data_coleta)}</text>
          </g>;
        })}
      </svg>
    </figure>
  );
}