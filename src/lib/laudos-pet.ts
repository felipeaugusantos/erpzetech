import type { ExameClinico, PontoEvolucao } from "./exames.ts";

export function evolucaoDosLaudos(exames: readonly ExameClinico[]) {
  const grupos = new Map<string, { nome: string; unidade: string | null; pontos: PontoEvolucao[] }>();
  for (const exame of exames) {
    if (exame.situacao !== "fechado") continue;
    for (const campo of exame.resultados) {
      if (!["numero", "calculado"].includes(campo.forma) || campo.valor_num === null || !Number.isFinite(campo.valor_num)) continue;
      const chave = JSON.stringify([campo.nome.trim().toLowerCase(), campo.unidade?.trim() ?? ""]);
      const grupo = grupos.get(chave) ?? { nome: campo.nome, unidade: campo.unidade, pontos: [] };
      // Duplicate analytes in one exam are ambiguous and must not be compared.
      if (exame.resultados.filter(r => r.nome.trim().toLowerCase() === campo.nome.trim().toLowerCase() && (r.unidade?.trim() ?? "") === (campo.unidade?.trim() ?? "")).length !== 1) continue;
      grupo.pontos.push({ exame_id: exame.id, exame: exame.nome, data_coleta: exame.data_coleta, valor: campo.valor_num, casas: campo.casas, faixa_min: campo.faixa_min, faixa_max: campo.faixa_max });
      grupos.set(chave, grupo);
    }
  }
  return [...grupos.values()].map(g => ({ ...g, pontos: g.pontos.sort((a, b) => a.data_coleta.localeCompare(b.data_coleta) || a.exame_id.localeCompare(b.exame_id)) })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}