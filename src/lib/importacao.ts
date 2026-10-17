// Importação por planilha (Fase 1): leitura do CSV, validação linha a linha e modelos para baixar.
// Roda no navegador para mostrar os erros antes de enviar; o banco confere tudo de novo (e é quem grava, numa transação).
import { cpfValido, soDigitos } from "./nfce-consumidor.ts";

export type TipoImportacao = "produtos" | "clientes" | "saldos";
export const LIMITE_LINHAS = 5000;

export const ROTULO_TIPO: Record<TipoImportacao, string> = {
  produtos: "Produtos",
  clientes: "Clientes",
  saldos: "Saldos de estoque",
};

type Campo = {
  chave: string;
  rotulo: string;
  /** Nomes aceitos no cabeçalho da planilha (sem acento, minúsculos, com "_" no lugar de espaços). */
  apelidos: string[];
  obrigatorio?: boolean;
  exemplo: string;
};

export const CAMPOS: Record<TipoImportacao, Campo[]> = {
  produtos: [
    {
      chave: "codigo_interno",
      rotulo: "Código",
      apelidos: ["codigo", "codigo_interno", "cod", "sku", "referencia"],
      obrigatorio: true,
      exemplo: "CIM-001",
    },
    {
      chave: "descricao",
      rotulo: "Descrição",
      apelidos: ["descricao", "produto", "nome"],
      obrigatorio: true,
      exemplo: "Cimento CP II 50 kg",
    },
    { chave: "unidade", rotulo: "Unidade", apelidos: ["unidade", "un", "und"], exemplo: "sc" },
    {
      chave: "preco_venda",
      rotulo: "Preço de venda",
      apelidos: ["preco_venda", "preco", "preco_de_venda", "valor", "valor_venda"],
      exemplo: "39,90",
    },
    {
      chave: "custo",
      rotulo: "Custo",
      apelidos: ["custo", "preco_de_custo", "preco_custo", "custo_unitario"],
      exemplo: "31,00",
    },
    {
      chave: "codigo_barras",
      rotulo: "Código de barras",
      apelidos: ["codigo_barras", "codigo_de_barras", "ean", "gtin"],
      exemplo: "7891234567895",
    },
    { chave: "ncm", rotulo: "NCM", apelidos: ["ncm"], exemplo: "25232990" },
    { chave: "cfop", rotulo: "CFOP", apelidos: ["cfop"], exemplo: "5102" },
    {
      chave: "cst_csosn",
      rotulo: "CST/CSOSN",
      apelidos: ["cst_csosn", "csosn", "cst"],
      exemplo: "102",
    },
    {
      chave: "categoria",
      rotulo: "Categoria",
      apelidos: ["categoria", "grupo"],
      exemplo: "Cimentos",
    },
    { chave: "marca", rotulo: "Marca", apelidos: ["marca"], exemplo: "Votoran" },
    { chave: "fabricante", rotulo: "Fabricante", apelidos: ["fabricante"], exemplo: "" },
    {
      chave: "estoque_minimo",
      rotulo: "Estoque mínimo",
      apelidos: ["estoque_minimo", "minimo", "est_min"],
      exemplo: "20",
    },
    {
      chave: "estoque_maximo",
      rotulo: "Estoque máximo",
      apelidos: ["estoque_maximo", "maximo", "est_max"],
      exemplo: "200",
    },
    {
      chave: "localizacao",
      rotulo: "Localização",
      apelidos: ["localizacao", "local", "corredor"],
      exemplo: "Corredor 3",
    },
  ],
  clientes: [
    {
      chave: "nome",
      rotulo: "Nome",
      apelidos: ["nome", "razao_social", "cliente"],
      obrigatorio: true,
      exemplo: "Construtora Alfa Ltda",
    },
    {
      chave: "documento",
      rotulo: "CPF ou CNPJ",
      apelidos: ["cpf_cnpj", "cpf", "cnpj", "documento", "cpf_ou_cnpj"],
      exemplo: "11.222.333/0001-81",
    },
    {
      chave: "nome_fantasia",
      rotulo: "Nome fantasia",
      apelidos: ["nome_fantasia", "fantasia"],
      exemplo: "Alfa",
    },
    {
      chave: "inscricao_estadual",
      rotulo: "Inscrição estadual",
      apelidos: ["inscricao_estadual", "ie"],
      exemplo: "",
    },
    {
      chave: "telefone",
      rotulo: "Telefone",
      apelidos: ["telefone", "fone"],
      exemplo: "(11) 3333-4444",
    },
    {
      chave: "whatsapp",
      rotulo: "WhatsApp",
      apelidos: ["whatsapp", "celular"],
      exemplo: "(11) 99999-0000",
    },
    {
      chave: "email",
      rotulo: "E-mail",
      apelidos: ["email", "e_mail"],
      exemplo: "contato@alfa.com.br",
    },
    { chave: "cep", rotulo: "CEP", apelidos: ["cep"], exemplo: "01001-000" },
    {
      chave: "endereco",
      rotulo: "Endereço",
      apelidos: ["endereco", "logradouro", "rua"],
      exemplo: "Rua das Obras",
    },
    { chave: "numero", rotulo: "Número", apelidos: ["numero", "num"], exemplo: "100" },
    { chave: "complemento", rotulo: "Complemento", apelidos: ["complemento"], exemplo: "" },
    { chave: "bairro", rotulo: "Bairro", apelidos: ["bairro"], exemplo: "Centro" },
    { chave: "cidade", rotulo: "Cidade", apelidos: ["cidade", "municipio"], exemplo: "São Paulo" },
    { chave: "estado", rotulo: "Estado", apelidos: ["estado", "uf"], exemplo: "SP" },
    {
      chave: "limite_credito",
      rotulo: "Limite de crédito",
      apelidos: ["limite_credito", "limite", "limite_de_credito"],
      exemplo: "5000,00",
    },
    {
      chave: "prazo_padrao_dias",
      rotulo: "Prazo padrão (dias)",
      apelidos: ["prazo_padrao_dias", "prazo", "prazo_padrao"],
      exemplo: "30",
    },
  ],
  saldos: [
    {
      chave: "codigo_interno",
      rotulo: "Código do produto",
      apelidos: ["codigo", "codigo_do_produto", "codigo_interno", "cod", "sku", "referencia"],
      obrigatorio: true,
      exemplo: "CIM-001",
    },
    {
      chave: "deposito",
      rotulo: "Depósito",
      apelidos: ["deposito", "armazem"],
      exemplo: "Depósito principal",
    },
    {
      chave: "quantidade",
      rotulo: "Quantidade",
      apelidos: ["quantidade", "saldo", "estoque", "qtd", "qtde"],
      obrigatorio: true,
      exemplo: "80",
    },
  ],
};

const NUMERICOS: Record<TipoImportacao, string[]> = {
  produtos: ["preco_venda", "custo", "estoque_minimo", "estoque_maximo"],
  clientes: ["limite_credito", "prazo_padrao_dias"],
  saldos: ["quantidade"],
};

/** Minúsculas, sem acento e com "_" entre as palavras: "Preço de Venda" → "preco_de_venda". */
export const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Texto do arquivo: UTF-8; se vier com caracteres quebrados (planilha salva em Latin-1), lê de novo como Latin-1. */
export function decodificar(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}

/** CSV (separador ; , ou tabulação — o que o Excel ou uma colagem usar), com aspas e quebras de linha dentro das aspas. */
export function lerCsv(texto: string): string[][] {
  const conteudo = texto.replace(/^\uFEFF/, "");
  const primeira = conteudo.split(/\r?\n/, 1)[0] ?? "";
  const cont = (c: string) => primeira.split(c).length - 1;
  const sep =
    cont("\t") >= Math.max(cont(";"), cont(",")) && cont("\t") > 0
      ? "\t"
      : cont(";") >= cont(",")
        ? ";"
        : ",";

  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  const fechaCampo = () => {
    linha.push(campo.trim());
    campo = "";
  };
  const fechaLinha = () => {
    fechaCampo();
    if (linha.some((c) => c !== "")) linhas.push(linha);
    linha = [];
  };
  for (let i = 0; i < conteudo.length; i += 1) {
    const c = conteudo[i];
    if (aspas) {
      if (c === '"' && conteudo[i + 1] === '"') {
        campo += '"';
        i += 1;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) fechaCampo();
    else if (c === "\n") fechaLinha();
    else if (c !== "\r") campo += c;
  }
  if (campo !== "" || linha.length > 0) fechaLinha();
  return linhas;
}

/** Número em formato brasileiro ou americano. Vazio → null; texto que não é número → NaN. */
export function lerNumero(texto: string): number | null {
  const t = texto.replace(/R\$/gi, "").replace(/\s/g, "");
  if (t === "") return null;
  if (!/^-?(\d+([.,]\d+)?|\d{1,3}(\.\d{3})+(,\d+)?|\d{1,3}(,\d{3})+(\.\d+)?)$/.test(t))
    return Number.NaN;
  const virgula = t.lastIndexOf(",");
  const ponto = t.lastIndexOf(".");
  let normal: string;
  if (virgula >= 0 && ponto >= 0)
    normal = virgula > ponto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (virgula >= 0)
    normal = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  else normal = /^-?\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  return Number(normal);
}

export function cnpjValido(valor: string): boolean {
  const c = soDigitos(valor);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    const pesos =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...base].reduce((s, d, i) => s + Number(d) * (pesos[i] ?? 0), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
}

export type LinhaPlanilha = {
  /** Número da linha na planilha (a primeira linha de dados é a 2). */
  linha: number;
  valores: Record<string, string>;
  erros: string[];
  /** O que vai ao banco: texto, ou número nos campos numéricos. */
  envio: Record<string, string | number | null>;
};

export type Leitura = {
  tipo: TipoImportacao;
  linhas: LinhaPlanilha[];
  /** Colunas obrigatórias que não foram encontradas no cabeçalho. */
  faltando: string[];
  /** Colunas do arquivo que o sistema não conhece (ignoradas). */
  ignoradas: string[];
  /** Colunas reconhecidas, para mostrar ao usuário. */
  reconhecidas: string[];
  excedeLimite: boolean;
  totalErros: number;
};

/** Lê o arquivo, casa as colunas e valida cada linha. Não fala com o banco (existência e duplicidade com o que já está lá vêm da simulação). */
export function lerPlanilha(tipo: TipoImportacao, texto: string): Leitura {
  const grade = lerCsv(texto);
  const campos = CAMPOS[tipo];
  const cabecalho = (grade[0] ?? []).map(normalizar);
  const indice = new Map<string, number>();
  for (const c of campos) {
    const i = cabecalho.findIndex((h) => c.apelidos.includes(h));
    if (i >= 0) indice.set(c.chave, i);
  }
  const usados = new Set(indice.values());
  const ignoradas = (grade[0] ?? []).filter((h, i) => h !== "" && !usados.has(i));
  const faltando = campos.filter((c) => c.obrigatorio && !indice.has(c.chave)).map((c) => c.rotulo);
  const reconhecidas = campos.filter((c) => indice.has(c.chave)).map((c) => c.rotulo);

  const numericos = new Set(NUMERICOS[tipo]);
  const dados = grade.slice(1);
  const linhas: LinhaPlanilha[] = dados.slice(0, LIMITE_LINHAS + 1).map((cels, n) => {
    const valores: Record<string, string> = {};
    for (const c of campos) {
      const i = indice.get(c.chave);
      valores[c.chave] = i === undefined ? "" : (cels[i] ?? "");
    }
    const erros: string[] = [];
    const envio: Record<string, string | number | null> = {};
    for (const c of campos) {
      const v = valores[c.chave] ?? "";
      if (numericos.has(c.chave)) {
        const num = lerNumero(v);
        if (num !== null && Number.isNaN(num)) {
          erros.push(`${c.rotulo}: "${v}" não é um número`);
          envio[c.chave] = null;
        } else {
          if (num !== null && num < 0) erros.push(`${c.rotulo} não pode ser negativo`);
          envio[c.chave] = num;
        }
      } else envio[c.chave] = v === "" ? null : v;
    }
    for (const c of campos)
      if (c.obrigatorio && (valores[c.chave] ?? "") === "")
        erros.push(`Informe ${c.rotulo.toLowerCase()}`);
    validarCampos(tipo, valores, erros);
    return { linha: n + 2, valores, erros, envio };
  });

  marcarRepetidos(tipo, linhas);
  return {
    tipo,
    linhas,
    faltando,
    ignoradas,
    reconhecidas,
    excedeLimite: dados.length > LIMITE_LINHAS,
    totalErros: linhas.reduce((s, l) => s + l.erros.length, 0),
  };
}

function validarCampos(tipo: TipoImportacao, v: Record<string, string>, erros: string[]) {
  if (tipo === "produtos") {
    const ncm = soDigitos(v["ncm"] ?? "");
    if (ncm !== "" && ncm.length !== 8) erros.push("NCM deve ter 8 números");
    const cfop = soDigitos(v["cfop"] ?? "");
    if (cfop !== "" && cfop.length !== 4) erros.push("CFOP deve ter 4 números");
    if ((v["codigo_interno"] ?? "").length > 60) erros.push("Código com mais de 60 caracteres");
    if ((v["descricao"] ?? "").length > 200) erros.push("Descrição com mais de 200 caracteres");
    const min = lerNumero(v["estoque_minimo"] ?? "");
    const max = lerNumero(v["estoque_maximo"] ?? "");
    if (min !== null && max !== null && !Number.isNaN(min) && !Number.isNaN(max) && max < min)
      erros.push("Estoque máximo menor que o mínimo");
  } else if (tipo === "clientes") {
    const doc = soDigitos(v["documento"] ?? "");
    if (doc !== "") {
      if (doc.length === 11 && !cpfValido(doc)) erros.push("CPF inválido (confira os dígitos)");
      else if (doc.length === 14 && !cnpjValido(doc))
        erros.push("CNPJ inválido (confira os dígitos)");
      else if (doc.length !== 11 && doc.length !== 14)
        erros.push("CPF deve ter 11 números e CNPJ 14");
    }
    const uf = (v["estado"] ?? "").trim();
    if (uf !== "" && !/^[A-Za-z]{2}$/.test(uf)) erros.push("Estado deve ter 2 letras (ex.: SP)");
    const email = (v["email"] ?? "").trim();
    if (email !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erros.push("E-mail inválido");
    if ((v["nome"] ?? "").length > 200) erros.push("Nome com mais de 200 caracteres");
  } else {
    const q = lerNumero(v["quantidade"] ?? "");
    if (q !== null && !Number.isNaN(q) && q <= 0)
      erros.push("Informe uma quantidade maior que zero (para zerar um saldo, use o inventário)");
  }
}

/** Repetidos dentro da própria planilha: segunda aparição em diante vira erro. */
function marcarRepetidos(tipo: TipoImportacao, linhas: LinhaPlanilha[]) {
  const vistos = new Map<string, number>();
  for (const l of linhas) {
    let chave: string;
    let rotulo: string;
    if (tipo === "produtos") {
      rotulo = l.valores["codigo_interno"] ?? "";
      chave = rotulo.toLowerCase();
    } else if (tipo === "clientes") {
      const doc = soDigitos(l.valores["documento"] ?? "");
      rotulo = doc !== "" ? doc : (l.valores["nome"] ?? "");
      chave = doc !== "" ? `d:${doc}` : `n:${(l.valores["nome"] ?? "").toLowerCase()}`;
    } else {
      rotulo = l.valores["codigo_interno"] ?? "";
      chave = `${rotulo.toLowerCase()}|${(l.valores["deposito"] ?? "").toLowerCase()}`;
    }
    if (rotulo === "" || chave === "|") continue;
    const antes = vistos.get(chave);
    if (antes !== undefined) {
      l.erros.push(
        tipo === "saldos"
          ? `${rotulo} aparece de novo para o mesmo depósito (primeira vez na linha ${antes})`
          : `${rotulo} repetido (primeira vez na linha ${antes})`,
      );
    } else vistos.set(chave, l.linha);
  }
}

/** Modelo para baixar: cabeçalho e uma linha de exemplo. */
export function modeloCsv(tipo: TipoImportacao): string {
  const campos = CAMPOS[tipo];
  const esc = (t: string) => (/[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
  return `\uFEFF${[campos.map((c) => c.rotulo), campos.map((c) => c.exemplo)].map((l) => l.map(esc).join(";")).join("\r\n")}\r\n`;
}

/** Corpo enviado ao banco (as chaves que as funções importar_* esperam). */
export function paraEnvio(l: Leitura): Record<string, string | number | null>[] {
  return l.linhas.map((x) => ({ linha: x.linha, ...x.envio }));
}

export type ErroImportacao = { linha: number; mensagem: string };

/** CSV de erros para o usuário corrigir a planilha: linha e motivo. */
export function csvErros(erros: ErroImportacao[]): string {
  const esc = (t: string) => (/[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
  return `\uFEFF${["linha;erro", ...erros.map((e) => `${e.linha};${esc(e.mensagem)}`)].join("\r\n")}\r\n`;
}

/** Todos os erros da leitura (da planilha) como lista linha + motivo. */
export function errosDaLeitura(l: Leitura): ErroImportacao[] {
  return l.linhas.flatMap((x) => x.erros.map((mensagem) => ({ linha: x.linha, mensagem })));
}
