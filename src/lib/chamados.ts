// Chamar o garçom pelo QR da mesa (ver a migration 20261216).

export type Chamado = {
  id: string;
  mesa_id: string;
  motivo: string;
  situacao: "aberto" | "atendido";
  criado_em: string;
};

export type MotivoChamado = { id: string; nome: string; ordem: number; ativo: boolean };

/** Endereço que o QR code da mesa abre. */
export function urlChamarMesa(origem: string, slug: string, mesaId: string): string {
  return `${origem.replace(/\/+$/, "")}/chamar/${encodeURIComponent(slug)}/${mesaId}`;
}

/** Motivos que a gestão pode criar com um clique. */
export const MOTIVOS_PADRAO = ["Chamar garçom", "Pedir a conta", "Pedir água", "Problema na mesa"];
