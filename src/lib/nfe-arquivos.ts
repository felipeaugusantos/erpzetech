import { jsPDF } from "jspdf";

import { brl, num } from "@/lib/format";

/** Dados da nota usados na geração do PDF e do XML. */
export type NotaArquivo = {
  id: string;
  numero: number | null;
  serie: number | null;
  situacao: string;
  ambiente: string | null;
  natureza_operacao: string | null;
  cfop: string | null;
  chave: string | null;
  protocolo: string | null;
  created_at: string;
  valor_produtos: number | string | null;
  valor_desconto: number | string | null;
  valor_frete: number | string | null;
  valor_total: number | string | null;
  base_icms?: number | string | null;
  valor_icms?: number | string | null;
  base_icms_st?: number | string | null;
  valor_icms_st?: number | string | null;
  valor_pis?: number | string | null;
  valor_cofins?: number | string | null;
  valor_iss?: number | string | null;
  emitente: Record<string, unknown> | null;
  destinatario: Record<string, unknown> | null;
};

export type ItemArquivo = {
  codigo: string | null;
  descricao: string;
  ncm: string | null;
  cfop: string | null;
  cst_csosn: string | null;
  unidade: string | null;
  quantidade: number | string;
  preco_unitario: number | string;
  total: number | string;
  aliquota_icms?: number | string | null;
  valor_icms?: number | string | null;
  valor_icms_st?: number | string | null;
  valor_pis?: number | string | null;
  valor_cofins?: number | string | null;
  valor_iss?: number | string | null;
};

const n = (v: unknown) => Number(v ?? 0);
const txt = (o: Record<string, unknown> | null, k: string) => String(o?.[k] ?? "");

function esc(valor: unknown) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Nome base do arquivo: chave da Receita quando houver, senão número da nota. */
export function nomeArquivoNota(nota: NotaArquivo) {
  if (nota.chave) return `NFe-${nota.chave}`;
  if (nota.numero) return `NFe-${String(nota.numero).padStart(6, "0")}-serie-${nota.serie ?? 1}`;
  return `NFe-rascunho-${nota.id.slice(0, 8)}`;
}

/** Baixa um conteúdo de texto como arquivo. */
export function baixarTexto(nomeArquivo: string, conteudo: string, mime: string) {
  const blob = new Blob([conteudo], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** XML da nota com emitente, destinatário, itens e impostos. */
export function gerarXmlNota(nota: NotaArquivo, itens: ItemArquivo[]) {
  const e = nota.emitente;
  const d = nota.destinatario;
  const linhas = itens
    .map(
      (i, idx) => `      <det nItem="${idx + 1}">
        <prod>
          <cProd>${esc(i.codigo)}</cProd>
          <xProd>${esc(i.descricao)}</xProd>
          <NCM>${esc(i.ncm)}</NCM>
          <CFOP>${esc(i.cfop)}</CFOP>
          <uCom>${esc(i.unidade)}</uCom>
          <qCom>${n(i.quantidade).toFixed(3)}</qCom>
          <vUnCom>${n(i.preco_unitario).toFixed(2)}</vUnCom>
          <vProd>${n(i.total).toFixed(2)}</vProd>
        </prod>
        <imposto>
          <ICMS>
            <CSOSN_CST>${esc(i.cst_csosn)}</CSOSN_CST>
            <pICMS>${n(i.aliquota_icms).toFixed(2)}</pICMS>
            <vICMS>${n(i.valor_icms).toFixed(2)}</vICMS>
            <vICMSST>${n(i.valor_icms_st).toFixed(2)}</vICMSST>
          </ICMS>
          <PIS><vPIS>${n(i.valor_pis).toFixed(2)}</vPIS></PIS>
          <COFINS><vCOFINS>${n(i.valor_cofins).toFixed(2)}</vCOFINS></COFINS>
          <ISS><vISS>${n(i.valor_iss).toFixed(2)}</vISS></ISS>
        </imposto>
      </det>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00">
  <NFe>
    <infNFe Id="${esc(nota.chave ?? "")}">
      <ide>
        <nNF>${nota.numero ?? ""}</nNF>
        <serie>${nota.serie ?? ""}</serie>
        <natOp>${esc(nota.natureza_operacao)}</natOp>
        <CFOP>${esc(nota.cfop)}</CFOP>
        <tpAmb>${esc(nota.ambiente)}</tpAmb>
        <dhEmi>${esc(nota.created_at)}</dhEmi>
        <situacao>${esc(nota.situacao)}</situacao>
      </ide>
      <emit>
        <xNome>${esc(txt(e, "razao_social"))}</xNome>
        <CNPJ>${esc(txt(e, "cnpj"))}</CNPJ>
        <IE>${esc(txt(e, "inscricao_estadual"))}</IE>
        <xLgr>${esc(txt(e, "endereco"))}</xLgr>
        <nro>${esc(txt(e, "numero"))}</nro>
        <xBairro>${esc(txt(e, "bairro"))}</xBairro>
        <xMun>${esc(txt(e, "cidade"))}</xMun>
        <UF>${esc(txt(e, "estado"))}</UF>
        <CEP>${esc(txt(e, "cep"))}</CEP>
        <xFil>${esc(txt(e, "filial"))}</xFil>
      </emit>
      <dest>
        <xNome>${esc(txt(d, "nome"))}</xNome>
        <CNPJ>${esc(txt(d, "cnpj"))}</CNPJ>
        <CPF>${esc(txt(d, "cpf"))}</CPF>
        <IE>${esc(txt(d, "inscricao_estadual"))}</IE>
        <xLgr>${esc(txt(d, "endereco"))}</xLgr>
        <nro>${esc(txt(d, "numero"))}</nro>
        <xBairro>${esc(txt(d, "bairro"))}</xBairro>
        <xMun>${esc(txt(d, "cidade"))}</xMun>
        <UF>${esc(txt(d, "estado"))}</UF>
        <CEP>${esc(txt(d, "cep"))}</CEP>
        <fone>${esc(txt(d, "telefone"))}</fone>
        <email>${esc(txt(d, "email"))}</email>
      </dest>
${linhas}
      <total>
        <ICMSTot>
          <vProd>${n(nota.valor_produtos).toFixed(2)}</vProd>
          <vDesc>${n(nota.valor_desconto).toFixed(2)}</vDesc>
          <vFrete>${n(nota.valor_frete).toFixed(2)}</vFrete>
          <vBC>${n(nota.base_icms).toFixed(2)}</vBC>
          <vICMS>${n(nota.valor_icms).toFixed(2)}</vICMS>
          <vBCST>${n(nota.base_icms_st).toFixed(2)}</vBCST>
          <vST>${n(nota.valor_icms_st).toFixed(2)}</vST>
          <vPIS>${n(nota.valor_pis).toFixed(2)}</vPIS>
          <vCOFINS>${n(nota.valor_cofins).toFixed(2)}</vCOFINS>
          <vISS>${n(nota.valor_iss).toFixed(2)}</vISS>
          <vNF>${n(nota.valor_total).toFixed(2)}</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
  <protNFe><nProt>${esc(nota.protocolo ?? "")}</nProt></protNFe>
</nfeProc>`;
}

/** PDF da nota (espelho do documento) pronto para baixar. */
export function gerarPdfNota(nota: NotaArquivo, itens: ItemArquivo[]) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const e = nota.emitente;
  const d = nota.destinatario;
  let y = 14;

  doc.setFontSize(13).setFont("helvetica", "bold");
  doc.text(txt(e, "razao_social") || "Empresa", 14, y);
  y += 5;
  doc.setFontSize(8).setFont("helvetica", "normal");
  doc.text(
    [
      txt(e, "cnpj") ? `CNPJ ${txt(e, "cnpj")}` : "",
      txt(e, "inscricao_estadual") ? `IE ${txt(e, "inscricao_estadual")}` : "",
      txt(e, "filial") ? `Loja ${txt(e, "filial")}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    14,
    y,
  );
  y += 4;
  doc.text(
    [
      `${txt(e, "endereco")} ${txt(e, "numero")}`.trim(),
      txt(e, "bairro"),
      `${txt(e, "cidade")}/${txt(e, "estado")}`,
      txt(e, "cep"),
    ]
      .filter((s) => s && s !== "/")
      .join(" · "),
    14,
    y,
  );

  y += 7;
  doc.setFontSize(11).setFont("helvetica", "bold");
  doc.text(
    nota.numero
      ? `NF-e nº ${String(nota.numero).padStart(6, "0")} · série ${nota.serie ?? 1}`
      : "NF-e em rascunho",
    14,
    y,
  );
  doc.setFontSize(8).setFont("helvetica", "normal");
  doc.text(
    `${nota.natureza_operacao ?? ""} · CFOP ${nota.cfop ?? "—"} · situação ${nota.situacao}`,
    14,
    y + 4,
  );
  y += 11;

  doc.setFont("helvetica", "bold").text("Destinatário", 14, y);
  doc.setFont("helvetica", "normal");
  y += 4;
  doc.text(
    [txt(d, "nome"), txt(d, "cnpj") || txt(d, "cpf"), txt(d, "inscricao_estadual")]
      .filter(Boolean)
      .join(" · "),
    14,
    y,
  );
  y += 4;
  doc.text(
    [
      `${txt(d, "endereco")} ${txt(d, "numero")}`.trim(),
      txt(d, "bairro"),
      `${txt(d, "cidade")}/${txt(d, "estado")}`,
      txt(d, "cep"),
      txt(d, "telefone"),
    ]
      .filter((s) => s && s !== "/")
      .join(" · "),
    14,
    y,
  );

  y += 8;
  doc.setFont("helvetica", "bold");
  doc.text("Produto", 14, y);
  doc.text("NCM", 96, y);
  doc.text("Qtd", 122, y, { align: "right" });
  doc.text("Unit.", 148, y, { align: "right" });
  doc.text("Total", 196, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  y += 2;
  doc.line(14, y, 196, y);
  y += 4;

  for (const i of itens) {
    if (y > 268) {
      doc.addPage();
      y = 16;
    }
    doc.text(String(i.descricao).slice(0, 48), 14, y);
    doc.text(String(i.ncm ?? "—"), 96, y);
    doc.text(`${num(n(i.quantidade), 3)} ${i.unidade ?? ""}`, 122, y, { align: "right" });
    doc.text(brl(n(i.preco_unitario)), 148, y, { align: "right" });
    doc.text(brl(n(i.total)), 196, y, { align: "right" });
    y += 5;
  }

  y += 2;
  doc.line(14, y, 196, y);
  y += 5;

  const linhasTotais: [string, string][] = [
    ["Produtos", brl(n(nota.valor_produtos))],
    ["Desconto", brl(n(nota.valor_desconto))],
    ["Frete", brl(n(nota.valor_frete))],
    ["Base ICMS", brl(n(nota.base_icms))],
    ["ICMS", brl(n(nota.valor_icms))],
    ["ICMS substituição", brl(n(nota.valor_icms_st))],
    ["PIS", brl(n(nota.valor_pis))],
    ["COFINS", brl(n(nota.valor_cofins))],
    ["ISS", brl(n(nota.valor_iss))],
  ];
  for (const [rotulo, valor] of linhasTotais) {
    doc.text(rotulo, 140, y);
    doc.text(valor, 196, y, { align: "right" });
    y += 4.5;
  }
  doc.setFont("helvetica", "bold").setFontSize(10);
  doc.text("TOTAL DA NOTA", 140, y + 1);
  doc.text(brl(n(nota.valor_total)), 196, y + 1, { align: "right" });

  y += 10;
  doc.setFont("helvetica", "normal").setFontSize(7);
  if (nota.chave) {
    doc.text(`Chave de acesso: ${nota.chave}`, 14, y);
    y += 4;
  }
  if (nota.situacao !== "autorizada") {
    doc.text(
      "Documento sem valor fiscal — espelho da nota antes da autorização pela Receita.",
      14,
      y,
    );
  }

  doc.save(`${nomeArquivoNota(nota)}.pdf`);
}
