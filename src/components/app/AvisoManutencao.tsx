import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

import { usePlanosManutencao } from "@/hooks/usePlanosManutencao";
import { ordenarPorUrgencia, resumoDosPlanos, textoDoProgresso } from "@/lib/manutencao-locacao";

/** Aviso dos planos de manutenção vencidos ou que vencem em breve; some quando está tudo em dia. */
export function AvisoManutencao({ comLink = false }: { comLink?: boolean }) {
  const { data: planos = [] } = usePlanosManutencao();
  const { vencidas, proximas } = resumoDosPlanos(planos);
  if (vencidas + proximas === 0) return null;
  const lista = ordenarPorUrgencia(planos)
    .filter((p) => p.situacao !== "em_dia")
    .slice(0, 5);
  return (
    <div
      role="alert"
      className={`mb-5 rounded-md border px-3 py-2 text-sm ${
        vencidas > 0
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4" />
        {vencidas > 0
          ? `${vencidas} manutenção(ões) vencida(s): o equipamento não sai para novo cliente até registrar.`
          : `${proximas} manutenção(ões) vencem em breve.`}
        {comLink && (
          <Link to="/locacao-equipamentos" className="ml-auto underline">
            Ver equipamentos
          </Link>
        )}
      </p>
      <ul className="mt-1 grid gap-0.5">
        {lista.map((p) => (
          <li key={p.plano_id}>
            <strong>{p.equipamento}</strong> · {p.nome}: {textoDoProgresso(p)}
          </li>
        ))}
      </ul>
    </div>
  );
}
