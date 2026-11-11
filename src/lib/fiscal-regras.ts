// Parametrização fiscal por NCM (plano em docs/parametrizacao-fiscal.md). Lógica pura, sem tela nem banco.
// Nada a usa ainda: serve de espelho para a função de banco e, depois, para o cadastro do produto e a emissão.
//
// Precedência de cada campo (o primeiro nível que define o valor vence):
//   1. item da nota  2. exceção do produto  3. regra da empresa  4. regra global  5. padrão da empresa.
// A regra (3 ou 4) é escolhida como um todo: qualquer regra da empresa que case vence a global, mesmo menos específica;
// dentro do mesmo nível vence a mais específica. Empate real NÃO é desempatado em silêncio: devolve as candidatas.

/** Campos de tributação que um perfil pode definir. */
export const CAMPOS_FISCAIS = [
  "cstIcms",
  "csosn",
  "cfop",
  "aliqIcms",
  "reducaoBaseIcms",
  "mvaSt",
  "cstPis",
  "aliqPis",
  "cstCofins",
  "aliqCofins",
  "cstIbsCbs",
  "cclasstrib",
  "origem",
] as const;

export type CampoFiscal = (typeof CAMPOS_FISCAIS)[number];
export type ValorFiscal = string | number | null | undefined;
/** Conjunto (parcial) de valores de tributação: um perfil, a exceção de um produto, o digitado no item ou o padrão da empresa. */
export type PerfilFiscal = Partial<Record<CampoFiscal, ValorFiscal>>;

export type RegraFiscal = {
  id: string;
  /** Prefixo do NCM, de 2 a 8 dígitos (só números). */
  ncmPrefixo: string;
  /** CEST de 7 dígitos; nulo = vale para qualquer. */
  cest?: string | null;
  /** Ex.: "venda", "devolucao"; nulo = qualquer operação. */
  operacao?: string | null;
  /** Ex.: "normal", "simples"; nulo = qualquer regime. */
  regime?: string | null;
  /** UF de destino (2 letras); nulo = todas. Já existe no modelo, mas a primeira versão não a preenche. */
  ufDestino?: string | null;
  /** Datas ISO (AAAA-MM-DD); o fim é inclusivo e nulo = sem fim. */
  vigenciaInicio: string;
  vigenciaFim?: string | null;
  versao: number;
  ativa: boolean;
  perfil: PerfilFiscal;
};

export type ContextoFiscal = {
  ncm: string;
  cest?: string | null;
  operacao?: string | null;
  regime?: string | null;
  ufDestino?: string | null;
  /** Data da operação (AAAA-MM-DD): só vale regra vigente nela. */
  data: string;
};

export type OrigemRegra = "empresa" | "global";
export type OrigemCampo = "item" | "produto" | OrigemRegra | "padrao";

export type EntradaResolucao = {
  contexto: ContextoFiscal;
  /** Valores digitados no item da nota. */
  item?: PerfilFiscal;
  /** Exceção gravada no produto. */
  produto?: PerfilFiscal;
  regrasEmpresa?: readonly RegraFiscal[];
  regrasGlobais?: readonly RegraFiscal[];
  /** Regras globais que a empresa decidiu ignorar. */
  globaisOcultas?: readonly string[];
  /** Padrão atual da empresa (Impostos). */
  padrao?: PerfilFiscal;
};

export type Resolucao = {
  /**
   * "regra": uma regra foi escolhida; "sem_regra": nenhuma casou (vale o padrão da empresa);
   * "empate": mais de uma regra igualmente específica (a pessoa escolhe, e o padrão NÃO é aplicado);
   * "ncm_invalido": o NCM não tem 8 dígitos (nenhuma regra é consultada, e o padrão NÃO é aplicado).
   */
  status: "regra" | "sem_regra" | "empate" | "ncm_invalido";
  regra: { id: string; versao: number; origem: OrigemRegra } | null;
  /** Só no empate: as regras que empataram, para a pessoa escolher. */
  candidatas: { regra: RegraFiscal; origem: OrigemRegra }[];
  campos: Partial<Record<CampoFiscal, { valor: string | number; origem: OrigemCampo }>>;
};

const soDigitos = (v: string | null | undefined): string => (v ?? "").replace(/\D/g, "");
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const definido = (v: ValorFiscal): v is string | number =>
  v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");

/** Confere o formato de uma regra (serve também para a prévia da importação). Lista vazia = regra válida. */
export function validarRegra(r: RegraFiscal): string[] {
  const erros: string[] = [];
  if (!/^\d{2,8}$/.test(r.ncmPrefixo)) erros.push("ncmPrefixo: use de 2 a 8 dígitos, só números");
  if (r.cest != null && !/^\d{7}$/.test(r.cest)) erros.push("cest: use 7 dígitos");
  if (r.ufDestino != null && !/^[A-Z]{2}$/.test(r.ufDestino))
    erros.push("ufDestino: use 2 letras maiúsculas");
  if (!DATA_ISO.test(r.vigenciaInicio)) erros.push("vigenciaInicio: use AAAA-MM-DD");
  if (r.vigenciaFim != null) {
    if (!DATA_ISO.test(r.vigenciaFim)) erros.push("vigenciaFim: use AAAA-MM-DD");
    else if (DATA_ISO.test(r.vigenciaInicio) && r.vigenciaFim < r.vigenciaInicio) {
      erros.push("vigenciaFim: não pode ser anterior ao início");
    }
  }
  if (!Number.isInteger(r.versao) || r.versao < 1)
    erros.push("versao: use um inteiro a partir de 1");
  return erros;
}

/** O regime da regra serve para o regime da empresa? O MEI é Simples Nacional: regra de "simples" também vale para o MEI. */
const regimeServe = (
  regraRegime: string | null | undefined,
  regimeEmpresa: string | null | undefined,
) =>
  regraRegime == null ||
  regraRegime === regimeEmpresa ||
  (regimeEmpresa === "mei" && regraRegime === "simples");

/** A regra vale para o contexto? (ativa, válida, vigente na data e com todos os critérios presentes casando.) */
export function regraCasa(r: RegraFiscal, ctx: ContextoFiscal): boolean {
  if (!r.ativa || validarRegra(r).length > 0 || !DATA_ISO.test(ctx.data)) return false;
  if (ctx.data < r.vigenciaInicio || (r.vigenciaFim != null && ctx.data > r.vigenciaFim))
    return false;
  if (!soDigitos(ctx.ncm).startsWith(r.ncmPrefixo)) return false;
  if (r.cest != null && r.cest !== soDigitos(ctx.cest)) return false;
  if (r.operacao != null && r.operacao !== ctx.operacao) return false;
  if (!regimeServe(r.regime, ctx.regime)) return false;
  if (r.ufDestino != null && r.ufDestino !== (ctx.ufDestino ?? "").toUpperCase()) return false;
  return true;
}

/**
 * Quanto maior, mais específica: NCM (mais dígitos), CEST, operação e regime, UF. Comparação em ordem, não soma.
 * Operação vale 2 e o regime vale 2 quando é o da empresa, ou 1 quando é "simples" usado no lugar de "mei"; sem regime, 0.
 * (Sem `regimeEmpresa`, qualquer regime preenchido vale 2.) Mesma pontuação de fiscal_sugerir no banco.
 */
export const especificidade = (
  r: RegraFiscal,
  regimeEmpresa?: string | null,
): [number, number, number, number] => [
  r.ncmPrefixo.length,
  r.cest != null ? 1 : 0,
  (r.operacao != null ? 2 : 0) +
    (r.regime == null ? 0 : regimeEmpresa === undefined || r.regime === regimeEmpresa ? 2 : 1),
  r.ufDestino != null ? 1 : 0,
];

function compararEspecificidade(
  a: RegraFiscal,
  b: RegraFiscal,
  regimeEmpresa: string | null | undefined,
): number {
  const ea = especificidade(a, regimeEmpresa);
  const eb = especificidade(b, regimeEmpresa);
  for (let i = 0; i < ea.length; i++) if (ea[i] !== eb[i]) return (ea[i] ?? 0) - (eb[i] ?? 0);
  return 0;
}

/** As regras mais específicas que casam: uma (vence) ou várias (empate). Vazio = nenhuma casa. */
export function melhoresRegras(regras: readonly RegraFiscal[], ctx: ContextoFiscal): RegraFiscal[] {
  const casam = regras.filter((r) => regraCasa(r, ctx));
  if (casam.length === 0) return [];
  const topo = casam.reduce((m, r) => (compararEspecificidade(r, m, ctx.regime) > 0 ? r : m));
  return casam.filter((r) => compararEspecificidade(r, topo, ctx.regime) === 0);
}

/** Aplica a precedência campo a campo e devolve o valor com a origem de cada um. */
export function resolverTributacao(entrada: EntradaResolucao): Resolucao {
  const { contexto } = entrada;
  const camadas: { origem: OrigemCampo; perfil: PerfilFiscal | undefined }[] = [];
  const vazio = (status: Resolucao["status"]): Resolucao => ({
    status,
    regra: null,
    candidatas: [],
    campos: {},
  });
  const preencher = (res: Resolucao) => {
    for (const campo of CAMPOS_FISCAIS) {
      for (const { origem, perfil } of camadas) {
        const valor = perfil?.[campo];
        if (definido(valor)) {
          res.campos[campo] = { valor, origem };
          break;
        }
      }
    }
    return res;
  };
  camadas.push(
    { origem: "item", perfil: entrada.item },
    { origem: "produto", perfil: entrada.produto },
  );

  if (soDigitos(contexto.ncm).length !== 8) return preencher(vazio("ncm_invalido"));

  const ocultas = new Set(entrada.globaisOcultas ?? []);
  const grupos: { origem: OrigemRegra; regras: readonly RegraFiscal[] }[] = [
    { origem: "empresa", regras: entrada.regrasEmpresa ?? [] },
    { origem: "global", regras: (entrada.regrasGlobais ?? []).filter((r) => !ocultas.has(r.id)) },
  ];
  for (const { origem, regras } of grupos) {
    const melhores = melhoresRegras(regras, contexto);
    if (melhores.length === 0) continue;
    if (melhores.length > 1) {
      const res = vazio("empate");
      res.candidatas = melhores.map((regra) => ({ regra, origem }));
      return preencher(res);
    }
    const regra = melhores[0];
    if (!regra) continue;
    camadas.push({ origem, perfil: regra.perfil });
    const res = vazio("regra");
    res.regra = { id: regra.id, versao: regra.versao, origem };
    camadas.push({ origem: "padrao", perfil: entrada.padrao });
    return preencher(res);
  }
  camadas.push({ origem: "padrao", perfil: entrada.padrao });
  return preencher(vazio("sem_regra"));
}
