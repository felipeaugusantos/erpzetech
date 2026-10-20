import { useEffect, useMemo, useState } from "react";

import {
  PREFIXO_PACIENTE,
  pacientesGuardados,
  petsDaAgenda,
  type PacienteGuardado,
  type PacienteParaAtender,
} from "@/lib/atendimento-offline";
import type { Cofre } from "@/lib/cofre";
import type { OperacaoFila } from "@/lib/fila-clinica";
import type { CopiaVisita } from "@/lib/visita";

/**
 * Pacientes que a visita pode atender: os cadastrados sem internet (guardados no cofre, mesmo depois de enviados) e os da agenda baixada.
 * Quem ainda tem o cadastro na fila leva a dependência dele.
 */
export function usePacientesVisita(
  cofre: Cofre,
  copia: CopiaVisita | null,
  fila: OperacaoFila[],
): PacienteParaAtender[] {
  const [guardados, setGuardados] = useState<PacienteGuardado[]>([]);
  useEffect(() => {
    let vivo = true;
    void cofre.listar<PacienteGuardado>("copia").then(({ itens }) => {
      if (vivo)
        setGuardados(itens.filter(([k]) => k.startsWith(PREFIXO_PACIENTE)).map(([, p]) => p));
    });
    return () => {
      vivo = false;
    };
  }, [cofre, fila]);
  return useMemo(() => {
    const lista = pacientesGuardados(guardados, fila);
    const ids = new Set(lista.map((p) => p.petId));
    for (const p of copia ? petsDaAgenda(copia) : []) if (!ids.has(p.petId)) lista.push(p);
    return lista;
  }, [guardados, fila, copia]);
}
