/* eslint-disable @typescript-eslint/no-explicit-any -- payloads dinâmicos do emissor fiscal (ACBr) e cliente Supabase sem tipos */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cnpjAlfaValido, limparDocumento } from "./cnpj-alfa.ts";
import {
  TRIBUTACAO_INTEGRAL,
  calcularItemIbsCbs,
  crtDoRegime,
  exigenciaIbsCbs,
  grupoIbsCbsDoItem,
  grupoTotalIbsCbs,
  totaisIbsCbs,
  type ResultadoItemIbsCbs,
} from "./ibs-cbs.ts";
import { grupoPisCofins } from "./pis-cofins.ts";
import { chaveDaOrigemAjuste, ideAjuste } from "./nfe-ajuste.ts";
import {
  chaveDaOrigemComplementar,
  ideComplementar,
  itemComplementar,
} from "./nfe-complementar.ts";
import { carregarNota, cnpjsDaEmpresa, exigirPapelFiscal, filtrarPorCnpj } from "./nfe-escopo.ts";
import {
  cfopDevolucaoCompra,
  cfopDevolucaoVenda,
  chaveDaCompra,
  chavesDaVenda,
  ideDevolucao,
  nItemDaVenda,
} from "./nfe-devolucao.ts";
import {
  identEmissao,
  servicoEmOperacao,
  svcDaUf,
  validarJustificativaContingencia,
} from "./nfe-contingencia.ts";
import {
  MAX_CARTAS_POR_NOTA,
  anoDaInutilizacao,
  notasQueImpedemInutilizacao,
  situacaoDoEvento,
  validarCorrecao,
  validarInutilizacao,
} from "./nfe-eventos.ts";

/**
 * Emissão real de NF-e: monta o pedido de emissão, transmite à Sefaz pelo emissor
 * fiscal (ACBr API), consulta o status e cancela a nota autorizada.
 */

type Ctx = { supabase: any; userId: string };

const FORMA_PAGAMENTO: Record<string, string> = {
  dinheiro: "01",
  cartao_credito: "03",
  cartao_debito: "04",
  cartao: "03",
  crediario: "05",
  boleto: "15",
  transferencia: "16",
  pix: "17",
};

function tPagDe(forma: string | null): string {
  if (!forma) return "99";
  return FORMA_PAGAMENTO[forma] ?? "99";
}

const arred = (v: number, casas = 2) => Number(Number(v || 0).toFixed(casas));

function icmsDoItem(
  cstCsosn: string | null,
  origem: number,
  vProd: number,
  aliquota = 0,
  calc?: { vBC?: number; vICMS?: number; vBCST?: number; vST?: number },
) {
  const codigo = (cstCsosn ?? "").replace(/\D/g, "");
  const pST = arred(aliquota);
  // Usa os valores já calculados na nota quando existirem.
  const base = arred(calc?.vBC && calc.vBC > 0 ? calc.vBC : vProd);
  const baseST = arred(calc?.vBCST && calc.vBCST > 0 ? calc.vBCST : vProd);
  const vST = arred(
    calc?.vST && calc.vST > 0
      ? calc.vST
      : calc?.vICMS && calc.vICMS > 0
        ? calc.vICMS
        : (vProd * pST) / 100,
  );
  if (codigo.length === 3) {
    // Simples Nacional (CSOSN)
    if (codigo === "101") {
      return { ICMSSN101: { orig: origem, CSOSN: "101", pCredSN: 0, vCredICMSSN: 0 } };
    }
    if (codigo === "500") {
      // ICMS já recolhido por substituição tributária pelo fornecedor.
      return {
        ICMSSN500: {
          orig: origem,
          CSOSN: "500",
          ...(vST > 0 ? { vBCSTRet: baseST, pST, vICMSSTRet: vST } : {}),
        },
      };
    }
    if (codigo === "900") {
      return {
        ICMSSN900: {
          orig: origem,
          CSOSN: "900",
          modBC: 3,
          vBC: base,
          pICMS: pST,
          vICMS: vST,
        },
      };
    }
    return { [`ICMSSN${codigo}`]: { orig: origem, CSOSN: codigo } };
  }
  if (codigo === "00") {
    return {
      ICMS00: { orig: origem, CST: "00", modBC: 3, vBC: base, pICMS: pST, vICMS: vST },
    };
  }
  if (codigo === "40" || codigo === "41" || codigo === "50" || codigo === "51") {
    return { [`ICMS${codigo}`]: { orig: origem, CST: codigo } };
  }
  if (codigo === "60") {
    return {
      ICMS60: {
        orig: origem,
        CST: "60",
        ...(vST > 0 ? { vBCSTRet: baseST, pST, vICMSSTRet: vST } : {}),
      },
    };
  }
  // Padrão seguro para o Simples Nacional sem permissão de crédito.
  return { ICMSSN102: { orig: origem, CSOSN: "102" } };
}

/**
 * Grava o retorno da Sefaz na nota. O andamento da nota (situação, chave, protocolo, retorno) não pode ser
 * alterado por um usuário logado direto no banco, então o servidor grava com a chave de serviço, depois de
 * conferir o papel fiscal e a empresa em `carregarNota`.
 */
async function gravarNota(
  nota: { id: string; tenant_id: string },
  patch: Record<string, unknown>,
): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("nfe")
    .update(patch as never)
    .eq("id", nota.id)
    .eq("tenant_id", nota.tenant_id);
  return error ? error.message : null;
}

const AVISO_SEM_GRAVAR =
  " Atenção: o retorno da Sefaz não foi gravado na nota. Use Consultar para atualizá-la.";

async function configDaNota(supabase: any, nota: any) {
  const { data: cfgs, error } = await supabase
    .from("fiscal_config")
    .select("*")
    .eq("tenant_id", nota.tenant_id);
  if (error) throw error;
  const cfg = (cfgs ?? []).find((c: any) => c.empresa_id === nota.empresa_id) ?? (cfgs ?? [])[0];
  if (!cfg) throw new Error("Configuração fiscal não encontrada. Preencha a configuração fiscal.");
  return cfg;
}

function ambienteDe(valor: string | null): "homologacao" | "producao" {
  return valor === "producao" ? "producao" : "homologacao";
}

export const transmitirNfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { nfeId: string }) => {
    if (!input?.nfeId) throw new Error("Nota fiscal não informada");
    return { nfeId: input.nfeId };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbr, codigoMunicipioPorCep, CODIGO_UF, so, num } = await import("./acbr.server");

    const nota = await carregarNota(supabase, data.nfeId, userId);
    if (nota.situacao === "autorizada") throw new Error("Esta nota já está autorizada pela Sefaz.");
    if (nota.situacao === "cancelada") throw new Error("Esta nota foi cancelada.");

    const cfg = await configDaNota(supabase, nota);
    const ambiente = ambienteDe(nota.ambiente ?? cfg.ambiente);

    if (!cfg.certificado_nome) {
      throw new Error(
        "Certificado digital A1 ainda não enviado no painel do emissor fiscal. Envie o certificado e informe o nome dele na configuração fiscal.",
      );
    }

    const [{ data: empresa }, { data: destinatarioBruto }, { data: itens }] = await Promise.all([
      supabase.from("empresas").select("*").eq("id", nota.empresa_id).maybeSingle(),
      nota.fornecedor_id
        ? supabase.from("fornecedores").select("*").eq("id", nota.fornecedor_id).maybeSingle()
        : supabase.from("clientes").select("*").eq("id", nota.cliente_id).maybeSingle(),
      supabase
        .from("nfe_itens")
        .select(
          "*, produtos(origem_mercadoria, cest, cfop, ncm, codigo_barras, cst_ibs_cbs, cclasstrib)",
        )
        .eq("nfe_id", nota.id)
        .order("created_at", { ascending: true }),
    ]);
    if (!empresa) throw new Error("Empresa emitente não encontrada");
    if (!destinatarioBruto)
      throw new Error(
        nota.fornecedor_id ? "Fornecedor da nota não encontrado" : "Cliente da nota não encontrado",
      );
    // fornecedor (devolução de compra) entra com o mesmo formato do cliente: só CNPJ, sem código de município
    const cliente: any = nota.fornecedor_id
      ? {
          ...destinatarioBruto,
          nome: destinatarioBruto.razao_social,
          cpf: null,
          codigo_municipio: null,
          complemento: null,
        }
      : destinatarioBruto;
    if (!itens || itens.length === 0) throw new Error("A nota não tem itens");

    const cnpjEmitente = limparDocumento(String(empresa.cnpj ?? ""));
    if (!cnpjAlfaValido(cnpjEmitente))
      throw new Error("CNPJ da empresa emitente inválido ou ausente.");
    if (!empresa.inscricao_estadual) throw new Error("Inscrição estadual da empresa ausente.");

    // Código IBGE do emitente e do destinatário (busca pelo CEP quando faltar).
    let cMunEmit = empresa.codigo_municipio as string | null;
    if (!cMunEmit) {
      const achado = await codigoMunicipioPorCep(ambiente, empresa.cep ?? "");
      if (achado) {
        cMunEmit = achado.codigo;
        await supabase
          .from("empresas")
          .update({ codigo_municipio: achado.codigo })
          .eq("id", empresa.id);
      }
    }
    let cMunDest = cliente.codigo_municipio as string | null;
    if (!cMunDest) {
      const achado = await codigoMunicipioPorCep(ambiente, cliente.cep ?? "");
      if (achado) {
        cMunDest = achado.codigo;
        if (!nota.fornecedor_id)
          await supabase
            .from("clientes")
            .update({ codigo_municipio: achado.codigo })
            .eq("id", cliente.id);
      }
    }
    if (!cMunEmit)
      throw new Error(
        "Não foi possível identificar o município da empresa. Confira o CEP no cadastro.",
      );
    if (!cMunDest)
      throw new Error(
        "Não foi possível identificar o município do cliente. Confira o CEP do cliente.",
      );

    const ufEmit = String(empresa.estado ?? "").toUpperCase();
    const ufDest = String(cliente.estado ?? "").toUpperCase();
    const cUF = CODIGO_UF[ufEmit];
    if (!cUF) throw new Error("UF da empresa emitente inválida.");

    // CPF só tem números; o CNPJ pode ter letras nas 12 primeiras posições (NT 2026.004).
    const docCliente = cliente.cnpj ? limparDocumento(String(cliente.cnpj)) : so(cliente.cpf);
    const pj = docCliente.length === 14;
    if (!(pj ? /^[0-9A-Z]{12}\d{2}$/.test(docCliente) : docCliente.length === 11)) {
      throw new Error("CPF ou CNPJ do cliente inválido ou ausente.");
    }

    const valorProdutos = num(nota.valor_produtos);
    const valorFrete = num(nota.valor_frete);
    const valorDesconto = num(nota.valor_desconto);
    const valorTotal = num(nota.valor_total);

    const agora = new Date();
    // Reforma tributária (NT 2025.002-RTC): regime normal informa IBS/CBS em cada item e nos totais.
    // Simples e MEI só passam a informar a partir de 2027, com orientação em NT futura.
    const informaIbsCbs =
      exigenciaIbsCbs(crtDoRegime(cfg.regime_tributario), agora.toISOString().slice(0, 10)) ===
      "obrigatorio";
    const resultadosIbsCbs: ResultadoItemIbsCbs[] = [];

    // Nota de devolução de venda (nasce em devolucao_registrar, modo "nota"): sai como entrada, finalidade 4,
    // referenciando a NF-e de venda autorizada do pedido, com CFOP de devolução conforme o destino.
    const { data: devolucao, error: erroDevolucao } = await (supabase as any)
      .from("devolucoes")
      .select("id, pedido_id")
      .eq("nfe_id", nota.id)
      .maybeSingle();
    if (erroDevolucao) throw erroDevolucao;
    const interestadual = ufEmit !== ufDest;

    // Nota complementar (finNFe 2): complementa o valor de uma NF-e de venda autorizada. Referencia só essa nota
    // (a Sefaz recusa zero ou mais de uma), do mesmo emitente, e não pode referenciar outra complementar.
    let chaveComplementada: string | null = null;
    // Nota de ajuste (finNFe 3): mesma estrutura da complementar (uma só nota referenciada, item só de valor),
    // sem frete; uso excepcional, protegido na geração (só administrador, com motivo).
    let chaveAjustada: string | null = null;
    if (nota.ajusta_nfe_id) {
      const { data: original, error: erroOriginal } = await supabase
        .from("nfe")
        .select("chave, situacao, modelo, ajusta_nfe_id, fornecedor_id, tenant_id, empresa_id")
        .eq("id", nota.ajusta_nfe_id)
        .maybeSingle();
      if (erroOriginal) throw erroOriginal;
      if (
        !original ||
        original.tenant_id !== nota.tenant_id ||
        original.empresa_id !== nota.empresa_id
      )
        throw new Error("A nota original do ajuste não foi encontrada.");
      chaveAjustada = chaveDaOrigemAjuste(original as any);
      if (num(nota.valor_frete) > 0) {
        throw new Error("Nota de ajuste não pode ter frete.");
      }
    }
    if (nota.complementa_nfe_id) {
      const { data: original, error: erroOriginal } = await supabase
        .from("nfe")
        .select("chave, situacao, modelo, complementa_nfe_id, fornecedor_id, tenant_id, empresa_id")
        .eq("id", nota.complementa_nfe_id)
        .maybeSingle();
      if (erroOriginal) throw erroOriginal;
      if (
        !original ||
        original.tenant_id !== nota.tenant_id ||
        original.empresa_id !== nota.empresa_id
      )
        throw new Error("A nota original da complementar não foi encontrada.");
      chaveComplementada = chaveDaOrigemComplementar(original as any);
    }

    // Nota de devolução de compra (nasce em compra_devolucao_registrar, modo "nota"): sai como saída ao
    // fornecedor, finalidade 4, referenciando a NF-e de entrada da compra. O nItem do item na NF-e de entrada
    // não é guardado (o XML original não é armazenado), por isso o grupo DFeReferenciado dos itens não é enviado.
    const { data: devolucaoCompra, error: erroDevolucaoCompra } = await (supabase as any)
      .from("compra_devolucoes")
      .select("id, compra_id")
      .eq("nfe_id", nota.id)
      .maybeSingle();
    if (erroDevolucaoCompra) throw erroDevolucaoCompra;
    let chaveCompra: string | null = null;
    if (devolucaoCompra) {
      const { data: compra, error: erroCompra } = await supabase
        .from("compras")
        .select("nfe_chave")
        .eq("id", devolucaoCompra.compra_id)
        .maybeSingle();
      if (erroCompra) throw erroCompra;
      chaveCompra = chaveDaCompra(compra?.nfe_chave);
      const ieForn = String(cliente.inscricao_estadual ?? "")
        .trim()
        .toUpperCase();
      if (!so(ieForn) && ieForn !== "ISENTO") {
        throw new Error(
          "Cadastre a inscrição estadual do fornecedor (ou ISENTO) para emitir a nota de devolução.",
        );
      }
    }
    let chavesVenda: string[] = [];
    const itensDasVendas: { chave: string; itens: { produto_id: string | null }[] }[] = [];
    if (devolucao) {
      const { data: vendas, error: erroVendas } = await supabase
        .from("nfe_pedidos")
        .select("nfe(id, chave, situacao, modelo)")
        .eq("pedido_id", devolucao.pedido_id);
      if (erroVendas) throw erroVendas;
      const notasVenda = ((vendas ?? []) as any[]).map((v) => v.nfe).filter(Boolean);
      chavesVenda = chavesDaVenda(notasVenda, nota.id);
      if (informaIbsCbs) {
        // regime normal: cada item referencia o item da venda (grupo DFeReferenciado)
        for (const chave of chavesVenda) {
          const original = notasVenda.find((n: any) => n.chave === chave);
          const { data: itensVenda, error: erroItensVenda } = await supabase
            .from("nfe_itens")
            .select("produto_id")
            .eq("nfe_id", original.id)
            .order("created_at", { ascending: true });
          if (erroItensVenda) throw erroItensVenda;
          itensDasVendas.push({
            chave,
            itens: (itensVenda ?? []) as { produto_id: string | null }[],
          });
        }
      }
    }

    let totalPis = 0;
    let totalCofins = 0;
    const det = itens.map((item: any, indice: number) => {
      let dfeReferenciado: { chaveAcesso: string; nItem: number } | null = null;
      if (devolucao && informaIbsCbs) {
        for (const v of itensDasVendas) {
          const nItem = nItemDaVenda(v.itens, item.produto_id ?? null);
          if (nItem) {
            dfeReferenciado = { chaveAcesso: v.chave, nItem };
            break;
          }
        }
        if (!dfeReferenciado)
          throw new Error(
            `O produto ${item.descricao} não consta na NF-e de venda referenciada. Confira a devolução.`,
          );
      }
      const quantidade = num(item.quantidade, 4);
      const unitario = num(item.preco_unitario, 4);
      const totalItem = num(item.total);
      // PIS e COFINS: o grupo do XML depende do CST (Aliq, NT ou Outr); os totais somam o que cada item leva
      const pis = grupoPisCofins("PIS", {
        cst: item.cst_pis ?? cfg.cst_pis ?? "99",
        base: totalItem,
        aliquota: num(item.aliquota_pis ?? cfg.aliquota_pis ?? 0),
      });
      const cofins = grupoPisCofins("COFINS", {
        cst: item.cst_cofins ?? cfg.cst_cofins ?? "99",
        base: totalItem,
        aliquota: num(item.aliquota_cofins ?? cfg.aliquota_cofins ?? 0),
      });
      totalPis += pis.valor;
      totalCofins += cofins.valor;
      const origem = Number(item.produtos?.origem_mercadoria ?? 0) || 0;
      const ncm = so(item.ncm ?? item.produtos?.ncm);
      if (ncm.length !== 8) {
        throw new Error(`NCM inválido no produto ${item.descricao}. Corrija o NCM no cadastro.`);
      }
      const cfop = devolucao
        ? cfopDevolucaoVenda(item.cfop, interestadual)
        : devolucaoCompra
          ? cfopDevolucaoCompra(item.cfop, interestadual)
          : so(item.cfop ?? cfg.cfop_padrao) || "5102";
      const ean = so(item.produtos?.codigo_barras);
      const unidade = String(item.unidade ?? "UN").slice(0, 6);
      let ibsCbs: ReturnType<typeof grupoIbsCbsDoItem> | null = null;
      if (informaIbsCbs) {
        try {
          const r = calcularItemIbsCbs({
            cst: String(item.produtos?.cst_ibs_cbs ?? TRIBUTACAO_INTEGRAL.cst),
            cClassTrib: String(item.produtos?.cclasstrib ?? TRIBUTACAO_INTEGRAL.cClassTrib),
            // Base do IBS/CBS (UB16): valor do item menos desconto e menos PIS, COFINS e ICMS.
            baseCalculo: Math.max(
              0,
              num(
                num(quantidade * unitario) -
                  num(item.desconto) -
                  num(item.valor_pis) -
                  num(item.valor_cofins) -
                  num(item.valor_icms),
              ),
            ),
            ano: agora.getFullYear(),
          });
          resultadosIbsCbs.push(r);
          ibsCbs = grupoIbsCbsDoItem(r);
        } catch (e) {
          throw new Error(`IBS/CBS do produto ${item.descricao}: ${(e as Error).message}`);
        }
      }
      return {
        nItem: indice + 1,
        ...(dfeReferenciado ? { DFeReferenciado: dfeReferenciado } : {}),
        prod: {
          cProd: String(item.codigo ?? item.produto_id).slice(0, 60),
          cEAN: ean.length === 13 || ean.length === 14 || ean.length === 8 ? ean : "SEM GTIN",
          xProd: String(item.descricao ?? "").slice(0, 120),
          NCM: ncm,
          ...(item.produtos?.cest ? { CEST: so(item.produtos.cest) } : {}),
          CFOP: cfop,
          uCom: unidade,
          qCom: quantidade,
          vUnCom: unitario,
          vProd: num(quantidade * unitario),
          cEANTrib: ean.length === 13 || ean.length === 14 || ean.length === 8 ? ean : "SEM GTIN",
          uTrib: unidade,
          qTrib: quantidade,
          vUnTrib: unitario,
          ...(num(item.desconto) > 0 ? { vDesc: num(item.desconto) } : {}),
          ...(chaveComplementada || chaveAjustada ? itemComplementar(num(item.total)) : {}),
          indTot: 1,
        },
        imposto: {
          ICMS: icmsDoItem(
            item.cst_csosn,
            origem,
            num(quantidade * unitario),
            num(item.aliquota_icms ?? item.produtos?.aliquota_icms ?? 0),
            {
              vBC: num(item.base_icms),
              vICMS: num(item.valor_icms),
              vBCST: num(item.base_icms_st),
              vST: num(item.valor_icms_st),
            },
          ),
          PIS: pis.grupo,
          COFINS: cofins.grupo,
          ...(ibsCbs ? { IBSCBS: ibsCbs } : {}),
        },
        ...(totalItem ? {} : {}),
      };
    });

    // contingência SVC aberta para a empresa emitente: emite pela SVC-AN/SVC-RS da UF
    const { data: contingenciaAberta, error: erroContingencia } = await (supabase as any)
      .from("nfe_contingencia")
      .select("justificativa, entrou_em")
      .eq("tenant_id", nota.tenant_id)
      .eq("empresa_id", nota.empresa_id)
      .is("saiu_em", null)
      .maybeSingle();
    if (erroContingencia) throw erroContingencia;
    const emissao = identEmissao(contingenciaAberta ?? null, ufEmit);

    const { data: pedidosDaNota } = await supabase
      .from("nfe_pedidos")
      .select("pedidos(numero, forma_pagamento, condicao_pagamento)")
      .eq("nfe_id", nota.id);
    const primeiroPedido = (pedidosDaNota ?? [])[0]?.pedidos ?? null;

    const payload = {
      ambiente,
      infNFe: {
        versao: "4.00",
        ide: {
          cUF,
          natOp: String(nota.natureza_operacao ?? "Venda de mercadoria").slice(0, 60),
          mod: 55,
          serie: Number(nota.serie ?? cfg.serie ?? 1),
          nNF: Number(nota.numero),
          dhEmi: agora.toISOString().replace("Z", "-00:00"),
          tpNF: 1,
          idDest: interestadual ? 2 : 1,
          cMunFG: cMunEmit,
          tpImp: 1,
          ...emissao,
          tpAmb: ambiente === "producao" ? 1 : 2,
          finNFe: 1,
          indFinal: pj ? 0 : 1,
          indPres: 1,
          procEmi: 0,
          verProc: "ERP Ze Tech 1.0",
          ...(devolucao ? ideDevolucao(chavesVenda) : {}),
          ...(chaveCompra ? ideDevolucao([chaveCompra], false) : {}),
          ...(chaveComplementada ? ideComplementar(chaveComplementada) : {}),
          ...(chaveAjustada ? ideAjuste(chaveAjustada) : {}),
        },
        emit: {
          CNPJ: cnpjEmitente,
          xNome: String(empresa.razao_social ?? "").slice(0, 60),
          IE: so(empresa.inscricao_estadual),
          CRT: cfg.regime_tributario === "simples" ? 1 : 3,
        },
        dest: {
          ...(pj ? { CNPJ: docCliente } : { CPF: docCliente }),
          xNome:
            ambiente === "homologacao"
              ? "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL"
              : String(cliente.nome ?? "").slice(0, 60),
          enderDest: {
            xLgr: String(cliente.endereco ?? "").slice(0, 60) || "SEM ENDERECO",
            nro: String(cliente.numero ?? "S/N").slice(0, 60),
            ...(cliente.complemento ? { xCpl: String(cliente.complemento).slice(0, 60) } : {}),
            xBairro: String(cliente.bairro ?? "CENTRO").slice(0, 60),
            cMun: cMunDest,
            xMun: String(cliente.cidade ?? "").slice(0, 60),
            UF: ufDest,
            ...(so(cliente.cep).length === 8 ? { CEP: so(cliente.cep) } : {}),
            ...(so(cliente.telefone) ? { fone: so(cliente.telefone).slice(0, 14) } : {}),
          },
          indIEDest:
            pj && so(cliente.inscricao_estadual)
              ? 1
              : pj &&
                  String(cliente.inscricao_estadual ?? "")
                    .trim()
                    .toUpperCase() === "ISENTO"
                ? 2
                : 9,
          ...(pj && so(cliente.inscricao_estadual) ? { IE: so(cliente.inscricao_estadual) } : {}),
          ...(cliente.email ? { email: String(cliente.email).slice(0, 60) } : {}),
        },
        det,
        total: {
          ICMSTot: {
            vBC: num(nota.base_icms),
            vICMS: num(nota.valor_icms),
            vICMSDeson: 0,
            vFCP: 0,
            vBCST: num(nota.base_icms_st),
            vST: num(nota.valor_icms_st),
            vFCPST: 0,
            vFCPSTRet: 0,
            vProd: valorProdutos,
            vFrete: valorFrete,
            vSeg: 0,
            vDesc: valorDesconto,
            vII: 0,
            vIPI: 0,
            vIPIDevol: 0,
            vPIS: num(totalPis),
            vCOFINS: num(totalCofins),
            vOutro: 0,
            vNF: valorTotal,
          },
          ...(resultadosIbsCbs.length > 0
            ? { IBSCBSTot: grupoTotalIbsCbs(totaisIbsCbs(resultadosIbsCbs)) }
            : {}),
        },
        transp: { modFrete: valorFrete > 0 ? 0 : 9 },
        pag: {
          detPag: [
            {
              indPag: primeiroPedido?.condicao_pagamento?.includes("prazo") ? 1 : 0,
              tPag: tPagDe(primeiroPedido?.forma_pagamento ?? null),
              vPag: valorTotal,
            },
          ],
        },
        ...(cfg.responsavel_tecnico_cnpj
          ? {
              infRespTec: {
                CNPJ: limparDocumento(String(cfg.responsavel_tecnico_cnpj)),
                xContato: String(cfg.responsavel_tecnico_contato ?? "Suporte"),
                email: String(cfg.responsavel_tecnico_email ?? empresa.email ?? ""),
                fone: so(cfg.responsavel_tecnico_fone ?? empresa.telefone ?? ""),
              },
            }
          : {}),
        ...(cfg.informacoes_complementares
          ? { infAdic: { infCpl: String(cfg.informacoes_complementares).slice(0, 500) } }
          : {}),
      },
    };

    try {
      const retorno = await acbr<any>(ambiente, "/nfe", { method: "POST", body: payload });
      const status = String(retorno?.status ?? "");
      const autorizada = status === "autorizado" || status === "autorizada";
      const rejeitada = status === "rejeitado" || status === "denegado";
      const mensagem =
        retorno?.autorizacao?.motivo_status ?? retorno?.autorizacao?.mensagem ?? null;

      const erroGravar = await gravarNota(nota, {
        provider: "acbr",
        provider_id: retorno?.id ?? null,
        provider_status: status || null,
        chave: retorno?.chave ?? nota.chave,
        protocolo: retorno?.autorizacao?.numero_protocolo ?? nota.protocolo,
        situacao: autorizada ? "autorizada" : rejeitada ? "rejeitada" : "transmitida",
        transmitida_em: new Date().toISOString(),
        tp_emis: emissao.tpEmis,
        ...(autorizada ? { autorizada_em: new Date().toISOString() } : {}),
        mensagem,
        retorno,
        pendencias: [],
      });

      return {
        ok: true,
        status: status || "pendente",
        chave: retorno?.chave ?? null,
        mensagem: erroGravar ? `${mensagem ?? ""}${AVISO_SEM_GRAVAR}` : mensagem,
      };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : "Falha ao transmitir a nota";
      const detalhe = (erro as Error & { detalhe?: unknown }).detalhe ?? null;
      await gravarNota(nota, {
        provider: "acbr",
        provider_status: "erro",
        situacao: "rejeitada",
        mensagem,
        ...(detalhe ? { retorno: detalhe } : {}),
      });
      throw new Error(mensagem);
    }
  });

export const consultarNfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { nfeId: string }) => {
    if (!input?.nfeId) throw new Error("Nota fiscal não informada");
    return { nfeId: input.nfeId };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbr } = await import("./acbr.server");

    const nota = await carregarNota(supabase, data.nfeId, userId);
    if (!nota.provider_id) throw new Error("Esta nota ainda não foi enviada ao emissor fiscal.");
    const ambiente = ambienteDe(nota.ambiente);

    const retorno = await acbr<any>(ambiente, `/nfe/${nota.provider_id}`);
    const status = String(retorno?.status ?? "");
    const autorizada = status === "autorizado" || status === "autorizada";
    const cancelada = status === "cancelado" || status === "cancelada";
    const rejeitada = status === "rejeitado" || status === "denegado";
    const mensagem = retorno?.autorizacao?.motivo_status ?? retorno?.autorizacao?.mensagem ?? null;

    const erroConsulta = await gravarNota(nota, {
      provider_status: status || null,
      chave: retorno?.chave ?? nota.chave,
      protocolo: retorno?.autorizacao?.numero_protocolo ?? nota.protocolo,
      situacao: autorizada
        ? "autorizada"
        : cancelada
          ? "cancelada"
          : rejeitada
            ? "rejeitada"
            : "transmitida",
      ...(autorizada && !nota.chave ? { autorizada_em: new Date().toISOString() } : {}),
      mensagem,
      retorno,
    });
    if (erroConsulta)
      throw new Error(
        `Não foi possível gravar o retorno da nota: ${erroConsulta}. Use Consultar para atualizá-la.`,
      );

    return { ok: true, status: status || "pendente", chave: retorno?.chave ?? null, mensagem };
  });

export const cancelarNfeSefaz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { nfeId: string; justificativa: string }) => {
    const justificativa = String(input?.justificativa ?? "").trim();
    if (!input?.nfeId) throw new Error("Nota fiscal não informada");
    if (justificativa.length < 15) {
      throw new Error("A justificativa do cancelamento precisa ter pelo menos 15 caracteres.");
    }
    return { nfeId: input.nfeId, justificativa };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbr } = await import("./acbr.server");

    const [{ data: ehAdmin }, { data: ehGestor }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "administrador" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "gestor" }),
    ]);
    if (!ehAdmin && !ehGestor)
      throw new Error("Somente administrador ou gestor pode cancelar a nota.");

    const nota = await carregarNota(supabase, data.nfeId, userId);
    if (!nota.provider_id) throw new Error("Esta nota ainda não foi enviada à Receita.");
    if (nota.situacao === "cancelada") throw new Error("Esta nota já está cancelada.");
    const ambiente = ambienteDe(nota.ambiente);

    const retorno = await acbr<any>(ambiente, `/nfe/${nota.provider_id}/cancelamento`, {
      method: "POST",
      body: { justificativa: data.justificativa },
    });

    const erroCancelamento = await gravarNota(nota, {
      situacao: "cancelada",
      cancelada_em: new Date().toISOString(),
      motivo_cancelamento: data.justificativa,
      provider_status: String(retorno?.status ?? "cancelado"),
      mensagem: retorno?.motivo_status ?? retorno?.mensagem ?? "Cancelamento registrado na Sefaz",
      retorno,
    });
    if (erroCancelamento)
      throw new Error(
        `Não foi possível gravar o retorno da nota: ${erroCancelamento}. Use Consultar para atualizá-la.`,
      );

    return { ok: true };
  });

/** Link do DANFE (PDF) e do XML autorizados, gerados pelo emissor fiscal. */
export const arquivosNfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { nfeId: string }) => {
    if (!input?.nfeId) throw new Error("Nota fiscal não informada");
    return { nfeId: input.nfeId };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbrToken, baseUrl } = await import("./acbr.server");

    const nota = await carregarNota(supabase, data.nfeId, userId);
    if (!nota.provider_id) throw new Error("Esta nota ainda não foi enviada à Receita.");
    const ambiente = ambienteDe(nota.ambiente);
    const token = await acbrToken();

    const buscar = async (caminho: string, tipo: string) => {
      const resposta = await fetch(`${baseUrl(ambiente)}${caminho}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resposta.ok) return null;
      const bytes = new Uint8Array(await resposta.arrayBuffer());
      let binario = "";
      for (const b of bytes) binario += String.fromCharCode(b);
      return `data:${tipo};base64,${btoa(binario)}`;
    };

    const [pdf, xml] = await Promise.all([
      buscar(`/nfe/${nota.provider_id}/pdf`, "application/pdf"),
      buscar(`/nfe/${nota.provider_id}/xml`, "application/xml"),
    ]);

    return { pdf, xml };
  });

/** Conferência da conta do emissor fiscal: conexão, empresas e certificados cadastrados. */
export const statusEmissor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    // a conta do emissor é compartilhada entre os clientes: só quem opera nota vê, e só as suas empresas
    const { tenantId } = await exigirPapelFiscal(supabase, userId);
    const meusCnpjs = await cnpjsDaEmpresa(supabase, tenantId);
    const { acbr } = await import("./acbr.server");
    try {
      const empresas = await acbr<{ data?: any[] }>("producao", "/empresas");
      const certificados = await acbr<{ data?: any[] }>("producao", "/empresas/certificados");
      const listaEmpresas = filtrarPorCnpj(
        (empresas?.data ?? []).map((e: any) => ({
          cpfCnpj: String(e?.cpf_cnpj ?? ""),
          nome: String(e?.razao_social ?? e?.nome ?? ""),
        })),
        meusCnpjs,
      );
      const listaCertificados = filtrarPorCnpj(
        (certificados?.data ?? []).map((c: any) => ({
          cpfCnpj: String(c?.cpf_cnpj ?? ""),
          nome: String(c?.razao_social ?? c?.nome ?? c?.cpf_cnpj ?? ""),
          validade: String(c?.data_validade ?? c?.validade ?? ""),
        })),
        meusCnpjs,
      ).map(({ nome, validade }) => ({ nome, validade }));
      return {
        conectado: true,
        mensagem: "Conexão com o emissor fiscal funcionando.",
        empresas: listaEmpresas,
        certificados: listaCertificados,
      };
    } catch (erro) {
      return {
        conectado: false,
        mensagem: erro instanceof Error ? erro.message : "Falha ao falar com o emissor fiscal.",
        empresas: [] as { cpfCnpj: string; nome: string }[],
        certificados: [] as { nome: string; validade: string }[],
      };
    }
  });

// ============ EVENTOS: carta de correção e inutilização ============

async function exigirPapel(supabase: any, userId: string, papeis: string[], mensagem: string) {
  const respostas = await Promise.all(
    papeis.map((r) => supabase.rpc("has_role", { _user_id: userId, _role: r })),
  );
  if (!respostas.some((r: any) => r.data === true)) throw new Error(mensagem);
}

async function gravarEvento(id: string, tenantId: string, patch: Record<string, unknown>) {
  const supabaseAdmin: any = (await import("@/integrations/supabase/client.server")).supabaseAdmin; // nfe_eventos ainda não está nos tipos gerados
  const { error } = await supabaseAdmin
    .from("nfe_eventos")
    .update(patch as never)
    .eq("id", id)
    .eq("tenant_id", tenantId);
  return error ? error.message : null;
}

/** Campos que o sistema guarda do retorno do emissor para um evento. */
function retornoDoEvento(retorno: any) {
  return {
    situacao: situacaoDoEvento(retorno?.status),
    provider_id: retorno?.id ? String(retorno.id) : null,
    protocolo: retorno?.numero_protocolo ?? null,
    mensagem: retorno?.motivo_status ?? retorno?.mensagem ?? null,
    retorno,
  };
}

/**
 * Carta de correção (CC-e) de nota autorizada. Não corrige valores, impostos, destinatário nem data de
 * emissão: isso a Sefaz não aceita e o sistema só conta o texto, quem conhece a regra é a tela e o contador.
 */
export const corrigirNfeSefaz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { nfeId: string; correcao: string }) => {
    if (!input?.nfeId) throw new Error("Nota fiscal não informada");
    return { nfeId: input.nfeId, correcao: validarCorrecao(input.correcao) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbr } = await import("./acbr.server");
    const supabaseAdmin: any = (await import("@/integrations/supabase/client.server"))
      .supabaseAdmin; // nfe_eventos ainda não está nos tipos gerados

    await exigirPapel(
      supabase,
      userId,
      ["administrador", "gestor", "financeiro"],
      "Somente administrador, gestor ou financeiro pode enviar carta de correção.",
    );
    const nota = await carregarNota(supabase, data.nfeId, userId);
    if (!nota.provider_id) throw new Error("Esta nota ainda não foi enviada à Receita.");
    if (nota.situacao !== "autorizada")
      throw new Error("Só nota autorizada aceita carta de correção.");
    const ambiente = ambienteDe(nota.ambiente);

    const { data: existentes, error: erroLista } = await supabaseAdmin
      .from("nfe_eventos")
      .select("sequencia, situacao")
      .eq("tenant_id", nota.tenant_id)
      .eq("nfe_id", nota.id)
      .eq("tipo", "carta_correcao")
      .in("situacao", ["pendente", "registrado"]);
    if (erroLista) throw erroLista;
    const lista = (existentes ?? []) as { sequencia: number; situacao: string }[];
    if (lista.some((e) => e.situacao === "pendente"))
      throw new Error(
        "Há uma carta de correção em andamento nesta nota. Atualize a situação antes de enviar outra.",
      );
    const sequencia = Math.max(0, ...lista.map((e) => e.sequencia)) + 1;
    if (sequencia > MAX_CARTAS_POR_NOTA)
      throw new Error(
        `A Sefaz aceita no máximo ${MAX_CARTAS_POR_NOTA} cartas de correção por nota.`,
      );

    // reserva a vaga antes de chamar a Sefaz: o índice único impede duas cartas ao mesmo tempo
    const { data: criado, error: erroCriar } = await supabaseAdmin
      .from("nfe_eventos")
      .insert({
        tenant_id: nota.tenant_id,
        empresa_id: nota.empresa_id,
        tipo: "carta_correcao",
        nfe_id: nota.id,
        sequencia,
        texto: data.correcao,
        ambiente,
        usuario_id: userId,
      } as never)
      .select("id")
      .single();
    if (erroCriar || !criado)
      throw new Error("Não foi possível registrar a carta de correção. Tente de novo.");
    const eventoId = (criado as { id: string }).id;

    try {
      const retorno = await acbr<any>(ambiente, `/nfe/${nota.provider_id}/carta-correcao`, {
        method: "POST",
        body: { correcao: data.correcao },
      });
      const campos = retornoDoEvento(retorno);
      const erroGravar = await gravarEvento(eventoId, nota.tenant_id, campos);
      return {
        ok: campos.situacao === "registrado",
        situacao: campos.situacao,
        mensagem: erroGravar ? `${campos.mensagem ?? ""}${AVISO_SEM_GRAVAR}` : campos.mensagem,
      };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : "Falha ao enviar a carta de correção";
      const detalhe = (erro as Error & { detalhe?: unknown }).detalhe ?? null;
      await gravarEvento(eventoId, nota.tenant_id, {
        situacao: "erro",
        mensagem,
        ...(detalhe ? { retorno: detalhe } : {}),
      });
      throw new Error(mensagem);
    }
  });

/** Inutilização de uma faixa de numeração que nunca foi usada em nota. Só administrador ou gestor. */
export const inutilizarNumeracaoNfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { serie: number; numeroInicial: number; numeroFinal: number; justificativa: string }) =>
      validarInutilizacao(input ?? ({} as never)),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbr } = await import("./acbr.server");
    const supabaseAdmin: any = (await import("@/integrations/supabase/client.server"))
      .supabaseAdmin; // nfe_eventos ainda não está nos tipos gerados

    await exigirPapel(
      supabase,
      userId,
      ["administrador", "gestor"],
      "Somente administrador ou gestor pode inutilizar numeração.",
    );
    const { tenantId, empresaId } = await exigirPapelFiscal(supabase, userId);
    if (!empresaId) throw new Error("Seu perfil não está vinculado a uma empresa emitente.");

    const [{ data: empresa }, { data: cfgs }] = await Promise.all([
      supabase.from("empresas").select("cnpj").eq("id", empresaId).maybeSingle(),
      supabase.from("fiscal_config").select("*").eq("tenant_id", tenantId),
    ]);
    const cnpj = limparDocumento(String(empresa?.cnpj ?? ""));
    if (!cnpjAlfaValido(cnpj)) throw new Error("CNPJ da empresa emitente inválido ou ausente.");
    const cfg = (cfgs ?? []).find((c: any) => c.empresa_id === empresaId) ?? (cfgs ?? [])[0];
    if (!cfg)
      throw new Error("Configuração fiscal não encontrada. Preencha a configuração fiscal.");
    const ambiente = ambienteDe(cfg.ambiente);

    // número que já virou nota na Sefaz não se inutiliza: o caminho é o cancelamento
    const { data: notas, error: erroNotas } = await supabase
      .from("nfe")
      .select("numero, situacao")
      .eq("tenant_id", tenantId)
      .eq("empresa_id", empresaId)
      .eq("serie", data.serie)
      .eq("ambiente", ambiente)
      .gte("numero", data.numeroInicial)
      .lte("numero", data.numeroFinal);
    if (erroNotas) throw erroNotas;
    const impedem = notasQueImpedemInutilizacao(
      (notas ?? []) as { numero: number | null; situacao: string }[],
      data.numeroInicial,
      data.numeroFinal,
    );
    if (impedem.length > 0) {
      throw new Error(
        `Já existe nota com estes números (${impedem
          .slice(0, 5)
          .map((n) => n.numero)
          .join(
            ", ",
          )}${impedem.length > 5 ? "…" : ""}). Número de nota emitida não se inutiliza; cancele a nota.`,
      );
    }

    // faixa que já foi inutilizada (ou está sendo) na mesma série
    const { data: anteriores, error: erroAnteriores } = await supabaseAdmin
      .from("nfe_eventos")
      .select("numero_inicial, numero_final")
      .eq("tenant_id", tenantId)
      .eq("empresa_id", empresaId)
      .eq("tipo", "inutilizacao")
      .eq("serie", data.serie)
      .eq("ambiente", ambiente)
      .in("situacao", ["pendente", "registrado"]);
    if (erroAnteriores) throw erroAnteriores;
    const sobrepoe = (
      (anteriores ?? []) as { numero_inicial: number; numero_final: number }[]
    ).some((a) => a.numero_inicial <= data.numeroFinal && a.numero_final >= data.numeroInicial);
    if (sobrepoe) throw new Error("Parte desta faixa já foi inutilizada ou está em andamento.");

    const ano = anoDaInutilizacao();
    const { data: criado, error: erroCriar } = await supabaseAdmin
      .from("nfe_eventos")
      .insert({
        tenant_id: tenantId,
        empresa_id: empresaId,
        tipo: "inutilizacao",
        texto: data.justificativa,
        serie: data.serie,
        numero_inicial: data.numeroInicial,
        numero_final: data.numeroFinal,
        ano,
        ambiente,
        usuario_id: userId,
      } as never)
      .select("id")
      .single();
    if (erroCriar || !criado)
      throw new Error("Não foi possível registrar a inutilização. Tente de novo.");
    const eventoId = (criado as { id: string }).id;

    try {
      const retorno = await acbr<any>(ambiente, "/nfe/inutilizacoes", {
        method: "POST",
        body: {
          ambiente,
          cnpj,
          ano,
          serie: data.serie,
          numero_inicial: data.numeroInicial,
          numero_final: data.numeroFinal,
          justificativa: data.justificativa,
        },
      });
      const campos = retornoDoEvento(retorno);
      const erroGravar = await gravarEvento(eventoId, tenantId, campos);
      return {
        ok: campos.situacao === "registrado",
        situacao: campos.situacao,
        mensagem: erroGravar ? `${campos.mensagem ?? ""}${AVISO_SEM_GRAVAR}` : campos.mensagem,
      };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : "Falha ao inutilizar a numeração";
      const detalhe = (erro as Error & { detalhe?: unknown }).detalhe ?? null;
      await gravarEvento(eventoId, tenantId, {
        situacao: "erro",
        mensagem,
        ...(detalhe ? { retorno: detalhe } : {}),
      });
      throw new Error(mensagem);
    }
  });

/** Atualiza um evento que ficou pendente (carta de correção ou inutilização) com o que a Sefaz já registrou. */
export const consultarEventoNfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { eventoId: string }) => {
    if (!input?.eventoId) throw new Error("Evento não informado");
    return { eventoId: input.eventoId };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbr } = await import("./acbr.server");
    const { tenantId } = await exigirPapelFiscal(supabase, userId);

    const { data: evento, error } = await (supabase as any)
      .from("nfe_eventos")
      .select("id, tenant_id, tipo, nfe_id, situacao, provider_id, ambiente")
      .eq("id", data.eventoId)
      .maybeSingle();
    if (error) throw error;
    if (!evento || evento.tenant_id !== tenantId) throw new Error("Evento não encontrado");
    if (evento.situacao !== "pendente") return { ok: true, situacao: evento.situacao as string };
    const ambiente = ambienteDe(evento.ambiente);

    let caminho: string;
    if (evento.tipo === "carta_correcao") {
      const nota = await carregarNota(supabase, evento.nfe_id, userId);
      if (!nota.provider_id) throw new Error("Esta nota ainda não foi enviada à Receita.");
      caminho = `/nfe/${nota.provider_id}/carta-correcao`;
    } else {
      if (!evento.provider_id) throw new Error("A inutilização ainda não tem número no emissor.");
      caminho = `/nfe/inutilizacoes/${evento.provider_id}`;
    }
    const retorno = await acbr<any>(ambiente, caminho);
    const campos = retornoDoEvento(retorno);
    const erroGravar = await gravarEvento(evento.id, tenantId, {
      ...campos,
      provider_id: campos.provider_id ?? evento.provider_id,
    });
    if (erroGravar) throw new Error(`Não foi possível gravar o retorno do evento: ${erroGravar}.`);
    return { ok: true, situacao: campos.situacao as string };
  });

// ============ CONTINGÊNCIA SVC ============

async function empresaDoPerfil(supabase: any, userId: string) {
  const { tenantId, empresaId } = await exigirPapelFiscal(supabase, userId);
  if (!empresaId) throw new Error("Seu perfil não está vinculado a uma empresa emitente.");
  const { data: empresa, error } = await supabase
    .from("empresas")
    .select("cnpj, estado")
    .eq("id", empresaId)
    .maybeSingle();
  if (error) throw error;
  if (!empresa) throw new Error("Empresa emitente não encontrada");
  return {
    tenantId,
    empresaId,
    empresa: empresa as { cnpj: string | null; estado: string | null },
  };
}

/** Situação da contingência da empresa e do serviço da Sefaz (normal e SVC), para decidir entrar ou sair. */
export const situacaoContingenciaNfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbr } = await import("./acbr.server");
    const { tenantId, empresaId, empresa } = await empresaDoPerfil(supabase, userId);

    const { data: aberta, error } = await (supabase as any)
      .from("nfe_contingencia")
      .select("id, autorizador, justificativa, entrou_em")
      .eq("tenant_id", tenantId)
      .eq("empresa_id", empresaId)
      .is("saiu_em", null)
      .maybeSingle();
    if (error) throw error;

    const svc = svcDaUf(empresa.estado);
    const cnpj = limparDocumento(String(empresa.cnpj ?? ""));
    const consultar = async (autorizador?: string) => {
      try {
        const r = await acbr<any>(
          "producao",
          `/nfe/sefaz/status?cpf_cnpj=${cnpj}${autorizador ? `&autorizador=${autorizador}` : ""}`,
        );
        return {
          emOperacao: servicoEmOperacao(r),
          motivo: (r?.motivo_status as string | undefined) ?? null,
        };
      } catch (e) {
        return { emOperacao: false, motivo: (e as Error).message };
      }
    };
    const [normal, contingencia] = await Promise.all([
      cnpjAlfaValido(cnpj) ? consultar() : Promise.resolve(null),
      cnpjAlfaValido(cnpj) && svc ? consultar(svc.autorizador) : Promise.resolve(null),
    ]);
    return {
      contingencia: aberta
        ? {
            autorizador: aberta.autorizador as string,
            justificativa: aberta.justificativa as string,
            entrouEm: aberta.entrou_em as string,
          }
        : null,
      svc: svc ? { nome: svc.nome, autorizador: svc.autorizador } : null,
      normal,
      servicoSvc: contingencia,
    };
  });

export const entrarContingenciaNfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { justificativa: string }) => ({
    justificativa: validarJustificativaContingencia(input?.justificativa),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    await exigirPapel(
      supabase,
      userId,
      ["administrador", "gestor"],
      "Somente administrador ou gestor pode entrar em contingência.",
    );
    const { tenantId, empresaId, empresa } = await empresaDoPerfil(supabase, userId);
    const svc = svcDaUf(empresa.estado);
    if (!svc)
      throw new Error("UF da empresa emitente inválida ou ausente: não dá para escolher a SVC.");

    const supabaseAdmin: any = (await import("@/integrations/supabase/client.server"))
      .supabaseAdmin; // nfe_contingencia ainda não está nos tipos gerados
    const { error } = await supabaseAdmin.from("nfe_contingencia").insert({
      tenant_id: tenantId,
      empresa_id: empresaId,
      tp_emis: svc.tpEmis,
      autorizador: svc.autorizador,
      justificativa: data.justificativa,
      usuario_entrada: userId,
    });
    if (error) {
      if (String(error.code) === "23505") throw new Error("A empresa já está em contingência.");
      throw new Error("Não foi possível registrar a contingência. Tente de novo.");
    }
    return { ok: true, autorizador: svc.nome };
  });

export const sairContingenciaNfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    await exigirPapel(
      supabase,
      userId,
      ["administrador", "gestor"],
      "Somente administrador ou gestor pode sair da contingência.",
    );
    const { tenantId, empresaId } = await empresaDoPerfil(supabase, userId);
    const supabaseAdmin: any = (await import("@/integrations/supabase/client.server"))
      .supabaseAdmin; // nfe_contingencia ainda não está nos tipos gerados
    const { data, error } = await supabaseAdmin
      .from("nfe_contingencia")
      .update({ saiu_em: new Date().toISOString(), usuario_saida: userId })
      .eq("tenant_id", tenantId)
      .eq("empresa_id", empresaId)
      .is("saiu_em", null)
      .select("id");
    if (error) throw new Error("Não foi possível encerrar a contingência. Tente de novo.");
    if (!data || data.length === 0) throw new Error("A empresa não está em contingência.");
    return { ok: true };
  });
