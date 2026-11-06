// Contrato da clínica (clínica + pet shop ou clínica sem pet shop): regras puras da tela da equipe, sem rede nem banco.
// O marcador e a regra do menu ficam em cnae-regras.ts (MARCADOR_SEM_PETSHOP) e ramo-clinica.ts (itemPetVisivel).
import { z } from "zod";

import { MARCADOR_SEM_PETSHOP, moduloLiberadoEmpresa, type EmpresaModulos } from "./cnae-regras.ts";

export const definirContratoClinica = z.object({
  empresaId: z.guid("Empresa inválida."),
  semPetshop: z.boolean(),
});

export type ContratoClinica = "clinica_e_petshop" | "clinica_sem_petshop";

export const ROTULO_CONTRATO: Record<ContratoClinica, string> = {
  clinica_e_petshop: "Clínica e pet shop",
  clinica_sem_petshop: "Só clínica (sem pet shop)",
};

export type EmpresaContrato = EmpresaModulos & {
  id: string;
  razao_social?: string | null;
  nome_fantasia?: string | null;
};

export type LinhaContrato = {
  id: string;
  nome: string;
  contrato: ContratoClinica;
  /** pet shop liberado de forma explícita: o marcador "sem pet shop" não teria efeito */
  petshopExplicito: boolean;
};

const nomeDaEmpresa = (e: EmpresaContrato) =>
  (e.nome_fantasia ?? "").trim() || (e.razao_social ?? "").trim() || "Empresa sem nome";

/** Contrato que a empresa tem hoje. Pet shop liberado de forma explícita vence o marcador. */
export function contratoDaEmpresa(empresa: EmpresaModulos): ContratoClinica {
  const liberados = empresa.modulos_liberados ?? [];
  return liberados.includes(MARCADOR_SEM_PETSHOP) && !liberados.includes("petshop")
    ? "clinica_sem_petshop"
    : "clinica_e_petshop";
}

/** Só empresas com clínica entram na tela, pela mesma regra que o app usa para liberar a clínica. */
export function montarLinhasContrato(
  empresas: readonly EmpresaContrato[],
  liberacoes: readonly { empresa_id: string; modulo: string }[],
): LinhaContrato[] {
  const porEmpresa = new Map<string, string[]>();
  for (const l of liberacoes)
    porEmpresa.set(l.empresa_id, [...(porEmpresa.get(l.empresa_id) ?? []), l.modulo]);
  return empresas
    .map((e) => ({ ...e, modulos_liberados: porEmpresa.get(e.id) ?? [] }))
    .filter((e) => moduloLiberadoEmpresa(e, "clinica"))
    .map((e) => ({
      id: e.id,
      nome: nomeDaEmpresa(e),
      contrato: contratoDaEmpresa(e),
      petshopExplicito: e.modulos_liberados.includes("petshop"),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export const AVISO_PETSHOP_EXPLICITO =
  "Esta empresa tem o pet shop liberado de forma explícita. Retire essa liberação antes de marcar “sem pet shop”.";

/** Mensagem para o operador quando a gravação falha (o CHECK da tabela recusa o marcador até a migração 0081 ser aplicada). */
export function mensagemErroContrato(codigo?: string | null, mensagem?: string | null): string {
  if (codigo === "23514" || /empresa_modulos_liberados_modulo_check/.test(mensagem ?? ""))
    return "O banco ainda não aceita este contrato. Aplique a migração 0081_clinica_sem_petshop.sql e tente de novo.";
  return "Não foi possível salvar o contrato.";
}
