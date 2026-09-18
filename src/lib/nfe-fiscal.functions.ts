import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

function icmsDoItem(cstCsosn: string | null, origem: number, vProd: number) {
  const codigo = (cstCsosn ?? "").replace(/\D/g, "");
  if (codigo.length === 3) {
    // Simples Nacional (CSOSN)
    if (codigo === "101") {
      return { ICMSSN101: { orig: origem, CSOSN: "101", pCredSN: 0, vCredICMSSN: 0 } };
    }
    if (codigo === "900") {
      return {
        ICMSSN900: {
          orig: origem, CSOSN: "900", modBC: 3, vBC: vProd, pICMS: 0, vICMS: 0,
        },
      };
    }
    return { [`ICMSSN${codigo}`]: { orig: origem, CSOSN: codigo } };
  }
  if (codigo === "00") {
    return { ICMS00: { orig: origem, CST: "00", modBC: 3, vBC: vProd, pICMS: 0, vICMS: 0 } };
  }
  if (codigo === "40" || codigo === "41" || codigo === "50" || codigo === "51") {
    return { [`ICMS${codigo}`]: { orig: origem, CST: codigo } };
  }
  if (codigo === "60") {
    return { ICMS60: { orig: origem, CST: "60" } };
  }
  // Padrão seguro para o Simples Nacional sem permissão de crédito.
  return { ICMSSN102: { orig: origem, CSOSN: "102" } };
}

async function carregarNota(supabase: any, nfeId: string) {
  const { data: nota, error } = await supabase
    .from("nfe")
    .select(
      "id, tenant_id, empresa_id, numero, serie, situacao, ambiente, natureza_operacao, cfop, valor_produtos, valor_desconto, valor_frete, valor_total, cliente_id, pendencias, provider_id, provider_status, chave, protocolo, mensagem",
    )
    .eq("id", nfeId)
    .maybeSingle();
  if (error) throw error;
  if (!nota) throw new Error("Nota fiscal não encontrada");
  return nota;
}

async function configDaNota(supabase: any, nota: any) {
  const { data: cfgs, error } = await supabase
    .from("fiscal_config")
    .select("*")
    .eq("tenant_id", nota.tenant_id);
  if (error) throw error;
  const cfg =
    (cfgs ?? []).find((c: any) => c.empresa_id === nota.empresa_id) ?? (cfgs ?? [])[0];
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
    const { supabase } = context as unknown as Ctx;
    const { acbr, codigoMunicipioPorCep, CODIGO_UF, so, num } = await import("./acbr.server");

    const nota = await carregarNota(supabase, data.nfeId);
    if (nota.situacao === "autorizada") throw new Error("Esta nota já está autorizada pela Sefaz.");
    if (nota.situacao === "cancelada") throw new Error("Esta nota foi cancelada.");

    const cfg = await configDaNota(supabase, nota);
    const ambiente = ambienteDe(nota.ambiente ?? cfg.ambiente);

    if (!cfg.certificado_nome) {
      throw new Error(
        "Certificado digital A1 ainda não enviado no painel do emissor fiscal. Envie o certificado e informe o nome dele na configuração fiscal.",
      );
    }

    const [{ data: empresa }, { data: cliente }, { data: itens }] = await Promise.all([
      supabase.from("empresas").select("*").eq("id", nota.empresa_id).maybeSingle(),
      supabase.from("clientes").select("*").eq("id", nota.cliente_id).maybeSingle(),
      supabase
        .from("nfe_itens")
        .select("*, produtos(origem_mercadoria, cest, cfop, ncm, codigo_barras)")
        .eq("nfe_id", nota.id)
        .order("created_at", { ascending: true }),
    ]);
    if (!empresa) throw new Error("Empresa emitente não encontrada");
    if (!cliente) throw new Error("Cliente da nota não encontrado");
    if (!itens || itens.length === 0) throw new Error("A nota não tem itens");

    const cnpjEmitente = so(empresa.cnpj);
    if (cnpjEmitente.length !== 14) throw new Error("CNPJ da empresa emitente inválido ou ausente.");
    if (!empresa.inscricao_estadual) throw new Error("Inscrição estadual da empresa ausente.");

    // Código IBGE do emitente e do destinatário (busca pelo CEP quando faltar).
    let cMunEmit = empresa.codigo_municipio as string | null;
    if (!cMunEmit) {
      const achado = await codigoMunicipioPorCep(ambiente, empresa.cep ?? "");
      if (achado) {
        cMunEmit = achado.codigo;
        await supabase.from("empresas").update({ codigo_municipio: achado.codigo }).eq("id", empresa.id);
      }
    }
    let cMunDest = cliente.codigo_municipio as string | null;
    if (!cMunDest) {
      const achado = await codigoMunicipioPorCep(ambiente, cliente.cep ?? "");
      if (achado) {
        cMunDest = achado.codigo;
        await supabase.from("clientes").update({ codigo_municipio: achado.codigo }).eq("id", cliente.id);
      }
    }
    if (!cMunEmit) throw new Error("Não foi possível identificar o município da empresa. Confira o CEP no cadastro.");
    if (!cMunDest) throw new Error("Não foi possível identificar o município do cliente. Confira o CEP do cliente.");

    const ufEmit = String(empresa.estado ?? "").toUpperCase();
    const ufDest = String(cliente.estado ?? "").toUpperCase();
    const cUF = CODIGO_UF[ufEmit];
    if (!cUF) throw new Error("UF da empresa emitente inválida.");

    const docCliente = so(cliente.cnpj || cliente.cpf);
    if (docCliente.length !== 11 && docCliente.length !== 14) {
      throw new Error("CPF ou CNPJ do cliente inválido ou ausente.");
    }
    const pj = docCliente.length === 14;

    const valorProdutos = num(nota.valor_produtos);
    const valorFrete = num(nota.valor_frete);
    const valorDesconto = num(nota.valor_desconto);
    const valorTotal = num(nota.valor_total);

    const det = itens.map((item: any, indice: number) => {
      const quantidade = num(item.quantidade, 4);
      const unitario = num(item.preco_unitario, 4);
      const totalItem = num(item.total);
      const origem = Number(item.produtos?.origem_mercadoria ?? 0) || 0;
      const ncm = so(item.ncm ?? item.produtos?.ncm);
      if (ncm.length !== 8) {
        throw new Error(`NCM inválido no produto ${item.descricao}. Corrija o NCM no cadastro.`);
      }
      const cfop = so(item.cfop ?? cfg.cfop_padrao) || "5102";
      const ean = so(item.produtos?.codigo_barras);
      const unidade = String(item.unidade ?? "UN").slice(0, 6);
      return {
        nItem: indice + 1,
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
          indTot: 1,
        },
        imposto: {
          ICMS: icmsDoItem(item.cst_csosn, origem, num(quantidade * unitario)),
          PIS: { PISOutr: { CST: "99", vBC: 0, pPIS: 0, vPIS: 0 } },
          COFINS: { COFINSOutr: { CST: "99", vBC: 0, pCOFINS: 0, vCOFINS: 0 } },
        },
        ...(totalItem ? {} : {}),
      };
    });

    const { data: pedidosDaNota } = await supabase
      .from("nfe_pedidos")
      .select("pedidos(numero, forma_pagamento, condicao_pagamento)")
      .eq("nfe_id", nota.id);
    const primeiroPedido = (pedidosDaNota ?? [])[0]?.pedidos ?? null;

    const agora = new Date();
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
          idDest: ufEmit === ufDest ? 1 : 2,
          cMunFG: cMunEmit,
          tpImp: 1,
          tpEmis: 1,
          tpAmb: ambiente === "producao" ? 1 : 2,
          finNFe: 1,
          indFinal: pj ? 0 : 1,
          indPres: 1,
          procEmi: 0,
          verProc: "Ze Obra 1.0",
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
          indIEDest: pj && cliente.inscricao_estadual ? 1 : 9,
          ...(pj && cliente.inscricao_estadual ? { IE: so(cliente.inscricao_estadual) } : {}),
          ...(cliente.email ? { email: String(cliente.email).slice(0, 60) } : {}),
        },
        det,
        total: {
          ICMSTot: {
            vBC: 0, vICMS: 0, vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0,
            vFCPST: 0, vFCPSTRet: 0, vProd: valorProdutos, vFrete: valorFrete,
            vSeg: 0, vDesc: valorDesconto, vII: 0, vIPI: 0, vIPIDevol: 0,
            vPIS: 0, vCOFINS: 0, vOutro: 0, vNF: valorTotal,
          },
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
                CNPJ: so(cfg.responsavel_tecnico_cnpj),
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

      await supabase
        .from("nfe")
        .update({
          provider: "acbr",
          provider_id: retorno?.id ?? null,
          provider_status: status || null,
          chave: retorno?.chave ?? nota.chave,
          protocolo: retorno?.autorizacao?.numero_protocolo ?? nota.protocolo,
          situacao: autorizada ? "autorizada" : rejeitada ? "rejeitada" : "transmitida",
          transmitida_em: new Date().toISOString(),
          ...(autorizada ? { autorizada_em: new Date().toISOString() } : {}),
          mensagem,
          retorno,
          pendencias: [],
        })
        .eq("id", nota.id);

      return { ok: true, status: status || "pendente", chave: retorno?.chave ?? null, mensagem };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : "Falha ao transmitir a nota";
      const detalhe = (erro as Error & { detalhe?: unknown }).detalhe ?? null;
      await supabase
        .from("nfe")
        .update({
          provider: "acbr",
          provider_status: "erro",
          situacao: "rejeitada",
          mensagem,
          ...(detalhe ? { retorno: detalhe } : {}),
        })
        .eq("id", nota.id);
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
    const { supabase } = context as unknown as Ctx;
    const { acbr } = await import("./acbr.server");

    const nota = await carregarNota(supabase, data.nfeId);
    if (!nota.provider_id) throw new Error("Esta nota ainda não foi enviada ao emissor fiscal.");
    const ambiente = ambienteDe(nota.ambiente);

    const retorno = await acbr<any>(ambiente, `/nfe/${nota.provider_id}`);
    const status = String(retorno?.status ?? "");
    const autorizada = status === "autorizado" || status === "autorizada";
    const cancelada = status === "cancelado" || status === "cancelada";
    const rejeitada = status === "rejeitado" || status === "denegado";
    const mensagem = retorno?.autorizacao?.motivo_status ?? retorno?.autorizacao?.mensagem ?? null;

    await supabase
      .from("nfe")
      .update({
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
      })
      .eq("id", nota.id);

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
    if (!ehAdmin && !ehGestor) throw new Error("Somente administrador ou gestor pode cancelar a nota.");

    const nota = await carregarNota(supabase, data.nfeId);
    if (!nota.provider_id) throw new Error("Esta nota ainda não foi enviada à Receita.");
    if (nota.situacao === "cancelada") throw new Error("Esta nota já está cancelada.");
    const ambiente = ambienteDe(nota.ambiente);

    const retorno = await acbr<any>(ambiente, `/nfe/${nota.provider_id}/cancelamento`, {
      method: "POST",
      body: { justificativa: data.justificativa },
    });

    await supabase
      .from("nfe")
      .update({
        situacao: "cancelada",
        cancelada_em: new Date().toISOString(),
        motivo_cancelamento: data.justificativa,
        provider_status: String(retorno?.status ?? "cancelado"),
        mensagem: retorno?.motivo_status ?? retorno?.mensagem ?? "Cancelamento registrado na Sefaz",
        retorno,
      })
      .eq("id", nota.id);

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
    const { supabase } = context as unknown as Ctx;
    const { acbrToken, baseUrl } = await import("./acbr.server");

    const nota = await carregarNota(supabase, data.nfeId);
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
  .handler(async () => {
    const { acbr } = await import("./acbr.server");
    try {
      const empresas = await acbr<{ data?: any[] }>("producao", "/empresas");
      const certificados = await acbr<{ data?: any[] }>("producao", "/empresas/certificados");
      const listaEmpresas = (empresas?.data ?? []).map((e: any) => ({
        cpfCnpj: String(e?.cpf_cnpj ?? ""),
        nome: String(e?.razao_social ?? e?.nome ?? ""),
      }));
      const listaCertificados = (certificados?.data ?? []).map((c: any) => ({
        nome: String(c?.razao_social ?? c?.nome ?? c?.cpf_cnpj ?? ""),
        validade: String(c?.data_validade ?? c?.validade ?? ""),
      }));
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
