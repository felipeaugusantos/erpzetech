import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { NfeXmlLida } from "@/lib/nfe-xml";

const n = z.number();
const s = z.string().nullable();
const Danfe = z.object({
  chave: s,
  numero: s,
  serie: s,
  emissao: s.describe("AAAA-MM-DD"),
  natureza: s,
  frete: n,
  desconto: n,
  total: n,
  seguro: n,
  outras: n,
  base_icms: n,
  icms: n,
  base_st: n,
  icms_st: n,
  ipi: n,
  pis: n,
  cofins: n,
  tributos_aprox: n,
  fornecedor: z.object({
    razao_social: z.string(),
    cnpj: s,
    telefone: s,
    cep: s,
    endereco: s,
    numero: s,
    bairro: s,
    cidade: s,
    estado: s,
  }),
  destinatario: z.object({ cnpj: s, nome: s }),
  vencimentos: z.array(z.object({ data: z.string().describe("AAAA-MM-DD"), valor: n })),
  itens: z.array(
    z.object({
      codigo: z.string(),
      descricao: z.string(),
      ncm: s,
      cst: s,
      cfop: s,
      unidade: z.string(),
      quantidade: n,
      valor_unitario: n,
      total: n,
      base_icms: n,
      icms: n,
      ipi: n,
      aliquota_icms: n,
      aliquota_ipi: n,
    }),
  ),
});

/** Lê o texto de um DANFE (PDF digital) com IA e devolve no mesmo formato do XML, para conferência. */
export const lerDanfePdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ texto: z.string().min(100).max(120_000) }).parse(d))
  .handler(async ({ data }): Promise<NfeXmlLida> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Serviço de IA não configurado");
    const { generateText, Output } = await import("ai");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const lovable = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey: key,
      headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });
    let d: z.infer<typeof Danfe>;
    try {
      const r = await generateText({
        model: lovable.responses("openai/gpt-6-astra"),
        output: Output.object({ schema: Danfe }),
        system:
          "Você extrai dados de um DANFE (NF-e brasileira) a partir do texto do PDF. Copie os valores exatamente como estão; números em formato decimal com ponto (1.234,56 vira 1234.56). Chave de acesso com 44 dígitos sem espaços. Não invente: campo ausente é null ou 0. Liste TODOS os produtos, em ordem, incluindo descrições que quebram linha. CNPJ só dígitos.",
        prompt: data.texto,
        providerOptions: { openai: { reasoningEffort: "low", store: false } },
      });
      d = r.output;
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 402)
        throw new Error("Créditos de IA esgotados.");
      if ((e as { statusCode?: number }).statusCode === 429)
        throw new Error("Muitas leituras agora. Tente de novo em instantes.");
      throw new Error("Não foi possível ler o PDF. Use o XML da nota.");
    }
    const dig = (v: string | null) => (v ? v.replace(/\D/g, "") || null : null);
    const venc = [...d.vencimentos].sort((a, b) => a.data.localeCompare(b.data));
    return {
      nota: {
        chave: dig(d.chave)?.length === 44 ? dig(d.chave) : null,
        numero: dig(d.numero)?.replace(/^0+/, "") || null,
        serie: dig(d.serie)?.replace(/^0+(?=\d)/, "") ?? null,
        emissao: d.emissao,
        natureza: d.natureza,
        frete: d.frete,
        desconto: d.desconto,
        total: d.total,
        condicao_pagamento: venc.length > 1 ? `${venc.length}x` : venc.length ? "a prazo" : null,
        primeiro_vencimento: venc[0]?.data ?? null,
        parcelas: Math.max(venc.length, 1),
        impostos: {
          base_icms: d.base_icms,
          icms: d.icms,
          base_st: d.base_st,
          icms_st: d.icms_st,
          fcp_st: 0,
          ipi: d.ipi,
          pis: d.pis,
          cofins: d.cofins,
          seguro: d.seguro,
          outras: d.outras,
          tributos_aprox: d.tributos_aprox,
        },
      },
      fornecedor: {
        ...d.fornecedor,
        cnpj: dig(d.fornecedor.cnpj),
        nome_fantasia: null,
        email: null,
      },
      destinatario: { cnpj: dig(d.destinatario.cnpj), nome: d.destinatario.nome },
      itens: d.itens.map((i, idx) => ({
        seq: idx + 1,
        codigo: i.codigo,
        codigo_barras: null,
        descricao: i.descricao,
        ncm: dig(i.ncm),
        cfop: dig(i.cfop),
        unidade: i.unidade || "UN",
        quantidade: i.quantidade,
        custo_unitario: i.quantidade ? i.total / i.quantidade : i.valor_unitario,
        total: i.total,
        lote: null,
        tonalidade: null,
        calibre: null,
        impostos: {
          cst: i.cst,
          base_icms: i.base_icms,
          aliquota_icms: i.aliquota_icms,
          icms: i.icms,
          base_st: 0,
          icms_st: 0,
          aliquota_ipi: i.aliquota_ipi,
          ipi: i.ipi,
          pis: 0,
          cofins: 0,
        },
      })),
    };
  });
