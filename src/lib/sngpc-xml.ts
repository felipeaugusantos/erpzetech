// Montagem dos arquivos XML do SNGPC (movimentação e inventário) e do .zip de transmissão, sem dependência de tela.
// Estrutura, nomes e ordem dos elementos seguem os exemplos do Guia para geração do padrão de transmissão SNGPC (Anvisa, v2.3).
// Uso veterinário: usoMedicamento = 2 e conselho do prescritor sempre CRMV. O XSD oficial não foi usado para validar:
// valide cada arquivo no validador da Anvisa antes do primeiro envio (docs/sngpc.md).

import type { DocumentoEnvio, InventarioSngpc, ItemEnvio, PeriodoSngpc } from "./sngpc.ts";

const ESPACO = "  ";
const CLASSE_CONTROLE_ESPECIAL = 2;
const TIPO_OPERACAO_NF_COMPRA = 1;
const USO_VETERINARIO = 2;

/** Escapa o texto e tira os caracteres de controle, que o XML 1.0 não aceita. */
export function escaparXml(t: string): string {
  let limpo = "";
  for (const ch of t) {
    const c = ch.codePointAt(0) ?? 0;
    // XML 1.0 só aceita tab, quebra de linha e a partir do espaço
    if (c === 9 || c === 10 || c === 13 || c >= 32) limpo += ch;
  }
  return limpo
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const tag = (nivel: number, nome: string, valor: string | number | null | undefined) =>
  `${ESPACO.repeat(nivel)}<${nome}>${escaparXml(String(valor ?? ""))}</${nome}>`;
const vazio = (nivel: number, nome: string) => `${ESPACO.repeat(nivel)}<${nome} />`;
const abre = (nivel: number, nome: string) => `${ESPACO.repeat(nivel)}<${nome}>`;
const fecha = (nivel: number, nome: string) => `${ESPACO.repeat(nivel)}</${nome}>`;

const so = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "");

function medicamentoEntrada(i: ItemEnvio, nivel: number) {
  return [
    abre(nivel, "medicamentoEntrada"),
    tag(nivel + 1, "classeTerapeutica", CLASSE_CONTROLE_ESPECIAL),
    tag(nivel + 1, "registroMSMedicamento", i.registro_ms),
    tag(nivel + 1, "numeroLoteMedicamento", i.lote),
    tag(nivel + 1, "quantidadeMedicamento", i.quantidade),
    tag(nivel + 1, "unidadeMedidaMedicamento", i.unidade_medida),
    fecha(nivel, "medicamentoEntrada"),
  ];
}

function itemSimples(nome: string, i: ItemEnvio, nivel: number) {
  return [
    abre(nivel, nome),
    tag(nivel + 1, "registroMSMedicamento", i.registro_ms),
    tag(nivel + 1, "numeroLoteMedicamento", i.lote),
    tag(nivel + 1, "quantidadeMedicamento", i.quantidade),
    tag(nivel + 1, "unidadeMedidaMedicamento", i.unidade_medida),
    fecha(nivel, nome),
  ];
}

function entrada(d: DocumentoEnvio, cnpjDestino: string): string[] {
  return [
    abre(3, "entradaMedicamentos"),
    abre(4, "notaFiscalEntradaMedicamento"),
    tag(5, "numeroNotaFiscal", d.nf_numero),
    tag(5, "tipoOperacaoNotaFiscal", TIPO_OPERACAO_NF_COMPRA),
    tag(5, "dataNotaFiscal", d.nf_data),
    tag(5, "cnpjOrigem", so(d.cnpj_origem)),
    tag(5, "cnpjDestino", cnpjDestino),
    fecha(4, "notaFiscalEntradaMedicamento"),
    ...d.itens.flatMap((i) => medicamentoEntrada(i, 4)),
    tag(4, "dataRecebimentoMedicamento", d.data),
    fecha(3, "entradaMedicamentos"),
  ];
}

function venda(d: DocumentoEnvio): string[] {
  const temPaciente = Boolean(d.paciente_nome);
  return [
    abre(3, "saidaMedicamentoVendaAoConsumidor"),
    tag(4, "tipoReceituarioMedicamento", d.tipo_receituario),
    tag(4, "numeroNotificacaoMedicamento", d.numero_notificacao),
    tag(4, "dataPrescricaoMedicamento", d.data_prescricao),
    abre(4, "prescritorMedicamento"),
    tag(5, "nomePrescritor", d.prescritor_nome),
    tag(5, "numeroRegistroProfissional", d.prescritor_registro),
    tag(5, "conselhoProfissional", "CRMV"),
    tag(5, "UFConselho", d.prescritor_uf),
    fecha(4, "prescritorMedicamento"),
    tag(4, "usoMedicamento", USO_VETERINARIO),
    abre(4, "compradorMedicamento"),
    tag(5, "nomeComprador", d.comprador_nome),
    tag(5, "tipoDocumento", d.comprador_tipo_documento),
    tag(5, "numeroDocumento", d.comprador_documento),
    tag(5, "orgaoExpedidor", d.comprador_orgao),
    tag(5, "UFEmissaoDocumento", d.comprador_uf),
    fecha(4, "compradorMedicamento"),
    ...(temPaciente
      ? [
          abre(4, "pacienteMedicamento"),
          tag(5, "nome", d.paciente_nome),
          tag(5, "idade", d.paciente_idade),
          tag(5, "unidadeIdade", d.paciente_unidade_idade),
          tag(5, "sexo", d.paciente_sexo),
          vazio(5, "cid"),
          fecha(4, "pacienteMedicamento"),
        ]
      : []),
    ...d.itens.flatMap((i) => [
      abre(4, "medicamentoVenda"),
      // controle especial: uso prolongado é sempre nulo (elemento vazio)
      vazio(5, "usoProlongado"),
      tag(5, "registroMSMedicamento", i.registro_ms),
      tag(5, "numeroLoteMedicamento", i.lote),
      tag(5, "quantidadeMedicamento", i.quantidade),
      tag(5, "unidadeMedidaMedicamento", i.unidade_medida),
      fecha(4, "medicamentoVenda"),
    ]),
    tag(4, "dataVendaMedicamento", d.data),
    fecha(3, "saidaMedicamentoVendaAoConsumidor"),
  ];
}

function perda(d: DocumentoEnvio): string[] {
  return [
    abre(3, "saidaMedicamentoPerda"),
    tag(4, "motivoPerdaMedicamento", d.motivo_perda),
    ...d.itens.flatMap((i) => itemSimples("medicamentoPerda", i, 4)),
    tag(4, "dataPerdaMedicamento", d.data),
    fecha(3, "saidaMedicamentoPerda"),
  ];
}

const CABECALHO_XML = '<?xml version="1.0" encoding="iso-8859-1" ?>';

/** XML de movimentação do período: entradas, dispensações e perdas, nesta ordem (como no exemplo do guia). */
export function gerarXmlMovimentacao(p: PeriodoSngpc, cpfTransmissor: string): string {
  const docs = (t: DocumentoEnvio["tipo"]) => p.documentos.filter((d) => d.tipo === t);
  const linhas = [
    CABECALHO_XML,
    '<mensagemSNGPC xmlns="urn:sngpc-schema">',
    abre(1, "cabecalho"),
    tag(2, "cnpjEmissor", so(p.cnpj)),
    tag(2, "cpfTransmissor", so(cpfTransmissor)),
    tag(2, "dataInicio", p.inicio),
    tag(2, "dataFim", p.fim),
    fecha(1, "cabecalho"),
    abre(1, "corpo"),
    abre(2, "medicamentos"),
    ...docs("entrada").flatMap((d) => entrada(d, so(p.cnpj))),
    ...docs("venda").flatMap(venda),
    ...docs("perda").flatMap(perda),
    fecha(2, "medicamentos"),
    fecha(1, "corpo"),
    "</mensagemSNGPC>",
  ];
  return linhas.join("\n") + "\n";
}

/** XML de inventário: o saldo de cada lote na data. */
export function gerarXmlInventario(inv: InventarioSngpc, cpfTransmissor: string): string {
  const linhas = [
    CABECALHO_XML,
    '<mensagemSNGPCInventario xmlns="urn:sngpc-schema">',
    abre(1, "cabecalho"),
    tag(2, "cnpjEmissor", so(inv.cnpj)),
    tag(2, "cpfTransmissor", so(cpfTransmissor)),
    tag(2, "data", inv.data),
    fecha(1, "cabecalho"),
    abre(1, "corpo"),
    abre(2, "medicamentos"),
    abre(3, "entradaMedicamentos"),
    ...inv.itens.flatMap((i) => medicamentoEntrada(i, 4)),
    fecha(3, "entradaMedicamentos"),
    fecha(2, "medicamentos"),
    fecha(1, "corpo"),
    "</mensagemSNGPCInventario>",
  ];
  return linhas.join("\n") + "\n";
}

/** Texto em ISO-8859-1 (o que o cabeçalho do XML declara). Fora do alfabeto latino vira "?". */
export function paraLatin1(texto: string): Uint8Array {
  const saida = new Uint8Array(texto.length);
  let n = 0;
  for (const ch of texto) {
    const c = ch.codePointAt(0) ?? 63;
    saida[n++] = c < 256 ? c : 63;
  }
  return saida.slice(0, n);
}

/** Quantas linhas o arquivo vai levar de cada operação (para a conferência antes de baixar). */
export function resumoDoPeriodo(p: PeriodoSngpc) {
  const conta = (t: DocumentoEnvio["tipo"]) => p.documentos.filter((d) => d.tipo === t).length;
  return {
    entradas: conta("entrada"),
    dispensacoes: conta("venda"),
    perdas: conta("perda"),
    itens: p.documentos.reduce((s, d) => s + d.itens.length, 0),
  };
}

// ---------- ZIP (sem compressão; a Anvisa só aceita o arquivo compactado) ----------

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of dados) c = TABELA_CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Data e hora no formato do ZIP (DOS). */
function dataDos(d: Date) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const data =
    ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, data };
}

/** Monta um .zip com os arquivos guardados sem compressão. */
export function criarZip(
  arquivos: readonly { nome: string; dados: Uint8Array }[],
  agora: Date = new Date(),
): Uint8Array {
  const { hora, data } = dataDos(agora);
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let deslocamento = 0;
  const codificador = new TextEncoder();
  for (const a of arquivos) {
    const nome = codificador.encode(a.nome);
    const crc = crc32(a.dados);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nome em UTF-8
    local.setUint16(8, 0, true);
    local.setUint16(10, hora, true);
    local.setUint16(12, data, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, a.dados.length, true);
    local.setUint32(22, a.dados.length, true);
    local.setUint16(26, nome.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nome, a.dados);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, hora, true);
    cd.setUint16(14, data, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, a.dados.length, true);
    cd.setUint32(24, a.dados.length, true);
    cd.setUint16(28, nome.length, true);
    cd.setUint32(42, deslocamento, true);
    central.push(new Uint8Array(cd.buffer), nome);
    deslocamento += 30 + nome.length + a.dados.length;
  }
  const tamanhoCentral = central.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true);
  fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, deslocamento, true);
  const todas = [...partes, ...central, new Uint8Array(fim.buffer)];
  const total = todas.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of todas) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}

/** Nome sugerido do arquivo (sem espaços nem acentos). */
export function nomeDoArquivo(tipo: "movimentacao" | "inventario", inicio: string, fim: string) {
  const d = (s: string) => s.replace(/-/g, "");
  return tipo === "movimentacao"
    ? `sngpc-movimentacao-${d(inicio)}-${d(fim)}`
    : `sngpc-inventario-${d(fim)}`;
}
