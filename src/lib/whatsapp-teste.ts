import { z } from "zod";
import { MENSAGEM_PADRAO, telefoneWhatsApp } from "./contato-pet.ts";
import { textoDoItem } from "./whatsapp-despacho.ts";

export const entradaTesteWhatsApp = z.object({
  numero: z
    .string()
    .max(30)
    .transform(telefoneWhatsApp)
    .refine((v) => v !== null, "Informe o número com DDD"),
  modelo: z.enum(["vacina_antes", "vacina_atrasada", "consulta_antes"]),
  tutor: z.string().trim().min(1).max(100),
  pet: z.string().trim().min(1).max(100),
  data: z.iso.date(),
  itens: z.string().trim().max(200),
});

export function textoTesteWhatsApp(
  dados: z.output<typeof entradaTesteWhatsApp>,
  loja: string,
  modeloSalvo?: string | null,
) {
  return textoDoItem({
    id: "teste",
    tenant_id: "",
    instancia: "",
    numero: dados.numero ?? "",
    tipo: dados.modelo === "consulta_antes" ? "retorno_consulta" : "reforco_vacina",
    tentativas: 1,
    modelo: modeloSalvo?.trim() || MENSAGEM_PADRAO[dados.modelo],
    loja,
    variaveis: { cliente: dados.tutor, pet: dados.pet, data: dados.data, itens: dados.itens },
  });
}
