import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ROTULO_MODULO, exemplosCnae, type ModuloCnae } from "@/lib/cnae";

/** Aviso mostrado quando a atividade da empresa ainda não libera o módulo. */
export function ModuloBloqueado({ modulo }: { modulo: ModuloCnae }) {
  return (
    <div className="panel mx-auto max-w-2xl p-6 text-center">
      <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-secondary">
        <Lock className="size-5 text-muted-foreground" />
      </span>
      <p className="font-display text-base font-semibold">
        {ROTULO_MODULO[modulo]} ainda não está liberado
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Este módulo é liberado pela atividade da empresa. Informe no cadastro da empresa o CNAE
        principal e os CNAEs secundários compatíveis para ativá-lo.
      </p>
      <ul className="mx-auto mt-4 max-w-md space-y-1 text-left text-xs text-muted-foreground">
        {exemplosCnae(modulo).map((e) => (
          <li key={e}>• {e}</li>
        ))}
      </ul>
      <Button asChild className="mt-5">
        <Link to="/empresa">Abrir cadastro da empresa</Link>
      </Button>
    </div>
  );
}
