import { z } from "zod";

export const preferenciasAssistenteSchema = z
  .object({
    nome: z.string().trim().min(1).max(80),
    boas_vindas: z.string().trim().min(1).max(1000),
    responsavel_numero: z
      .string()
      .regex(/^$|^[0-9]{10,15}$/, "Informe o número com DDD e código do país"),
    orcamentos: z.boolean(),
    agendamentos: z.boolean(),
  })
  .strict();

export type PreferenciasAssistente = z.infer<typeof preferenciasAssistenteSchema>;
