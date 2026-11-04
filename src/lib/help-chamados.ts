import { z } from "zod";

export const chamadoInput = z
  .object({
    requestId: z.string().uuid(),
    subject: z.string().trim().min(3).max(200),
    description: z.string().trim().min(3).max(20000),
    priority: z.enum(["baixa", "normal", "alta", "critica"]),
    name: z.string().trim().min(3).max(120),
    email: z.string().trim().email().max(160),
  })
  .strict();

export function empresaDoChamado(
  perfil: { tenant_id: string | null; ativo: boolean } | null,
  empresa: { id: string; tenant_id: string } | null,
) {
  if (!perfil?.ativo || !perfil.tenant_id || !empresa || empresa.tenant_id !== perfil.tenant_id)
    throw new Error("Empresa não disponível para este acesso.");
  return empresa.id;
}

export type Chamado = {
  id: string;
  number: string | number;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  resolution_due_at: string | null;
};
export type ListaChamados = { tickets: Chamado[]; total: number; page: number; error?: string };

export const situacoesChamado: Record<string, string> = {
  aberto: "Aberto",
  open: "Aberto",
  novo: "Novo",
  em_atendimento: "Em atendimento",
  in_progress: "Em atendimento",
  aguardando_cliente: "Aguardando cliente",
  resolvido: "Resolvido",
  resolved: "Resolvido",
  fechado: "Fechado",
  closed: "Fechado",
};
