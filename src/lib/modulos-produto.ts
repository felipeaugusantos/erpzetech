// Cadastro de produto por módulo, sem dependência de tela: a lista de campos de cada módulo, a conferência e o resumo.
// O módulo da empresa é o campo "ramo de atividade" (empresas.ramo_atividade). Os campos próprios ficam em produtos.dados_modulo
// e os campos comuns (código, NCM, preço, estoque, lote…) continuam nas colunas de sempre.
// O banco confere as chaves e os valores de lista (supabase/migrations/20261126000000_modulos_produto.sql): mantenha as duas
// listas iguais (há um teste que compara). A obrigatoriedade é conferida aqui, na tela, para não travar cadastros automáticos
// (nota de entrada, importação) que criam produtos sem passar pelo formulário.

export type TipoCampo = "texto" | "numero" | "opcoes" | "booleano";

export type CampoModulo = {
  chave: string;
  rotulo: string;
  tipo: TipoCampo;
  /** valores aceitos quando o tipo é "opcoes" (valor guardado e texto na tela) */
  opcoes?: readonly { valor: string; rotulo: string }[];
  obrigatorio?: boolean;
  ajuda?: string;
  placeholder?: string;
};

export type ModuloProduto = "construcao" | "petshop" | "clinica" | "lavarapido";

export type DefinicaoModulo = {
  rotulo: string;
  campos: readonly CampoModulo[];
};

const opcoes = (...pares: [string, string][]) =>
  pares.map(([valor, rotulo]) => ({ valor, rotulo }));

export const MODULOS_PRODUTO: Record<ModuloProduto, DefinicaoModulo> = {
  construcao: {
    rotulo: "Material de Construção",
    campos: [
      {
        chave: "linha_aplicacao",
        rotulo: "Linha ou aplicação",
        tipo: "texto",
        placeholder: "Ex.: hidráulica, elétrica, acabamento",
      },
      {
        chave: "bitola_medida",
        rotulo: "Bitola ou medida",
        tipo: "texto",
        placeholder: 'Ex.: 3/4", 25 mm, 60x60',
      },
      {
        chave: "cor_acabamento",
        rotulo: "Cor ou acabamento",
        tipo: "texto",
        placeholder: "Ex.: branco, cinza, fosco",
      },
      {
        chave: "venda_fracionada",
        rotulo: "Venda fracionada",
        tipo: "opcoes",
        opcoes: opcoes(
          ["nao", "Não"],
          ["m", "Metro (m)"],
          ["m2", "Metro quadrado (m²)"],
          ["m3", "Metro cúbico (m³)"],
          ["kg", "Quilo (kg)"],
        ),
        ajuda:
          "Marque se o produto é vendido em partes (cabo por metro, piso por m², areia por m³).",
      },
    ],
  },
  petshop: {
    rotulo: "Pet Shop",
    campos: [
      {
        chave: "especie",
        rotulo: "Espécie",
        tipo: "opcoes",
        opcoes: opcoes(
          ["todas", "Todas"],
          ["cao", "Cão"],
          ["gato", "Gato"],
          ["ave", "Ave"],
          ["peixe", "Peixe"],
          ["roedor", "Roedor"],
          ["outras", "Outras"],
        ),
      },
      {
        chave: "porte",
        rotulo: "Porte",
        tipo: "opcoes",
        opcoes: opcoes(
          ["todos", "Todos"],
          ["mini", "Mini"],
          ["pequeno", "Pequeno"],
          ["medio", "Médio"],
          ["grande", "Grande"],
          ["gigante", "Gigante"],
        ),
      },
      {
        chave: "fase_vida",
        rotulo: "Fase da vida",
        tipo: "opcoes",
        opcoes: opcoes(
          ["todas", "Todas"],
          ["filhote", "Filhote"],
          ["adulto", "Adulto"],
          ["senior", "Sênior"],
        ),
      },
      {
        chave: "sabor_linha",
        rotulo: "Sabor ou linha",
        tipo: "texto",
        placeholder: "Ex.: carne, frango, premium",
      },
      { chave: "peso_embalagem_kg", rotulo: "Peso da embalagem (kg)", tipo: "numero" },
      {
        chave: "registro_mapa",
        rotulo: "Registro no MAPA",
        tipo: "texto",
        ajuda: "Ração e suplemento têm registro no Ministério da Agricultura.",
      },
    ],
  },
  clinica: {
    rotulo: "Clínica Veterinária",
    campos: [
      {
        chave: "tipo",
        rotulo: "Tipo do produto",
        tipo: "opcoes",
        obrigatorio: true,
        opcoes: opcoes(
          ["medicamento", "Medicamento"],
          ["vacina", "Vacina"],
          ["material", "Material"],
          ["alimento_clinico", "Alimento clínico"],
        ),
      },
      { chave: "principio_ativo", rotulo: "Princípio ativo", tipo: "texto" },
      {
        chave: "concentracao_forma",
        rotulo: "Concentração e forma",
        tipo: "texto",
        placeholder: "Ex.: 500 mg comprimido, 10 mg/ml solução",
      },
      {
        chave: "via_administracao",
        rotulo: "Via de administração",
        tipo: "opcoes",
        opcoes: opcoes(
          ["oral", "Oral"],
          ["injetavel", "Injetável"],
          ["topica", "Tópica"],
          ["oftalmica", "Oftálmica"],
          ["otologica", "Otológica"],
          ["outra", "Outra"],
        ),
      },
      { chave: "registro_mapa", rotulo: "Registro no MAPA", tipo: "texto" },
      {
        chave: "controlado",
        rotulo: "Medicamento controlado",
        tipo: "booleano",
        ajuda: "Controlado exige guarda e registro especiais.",
      },
      {
        chave: "conservacao",
        rotulo: "Conservação",
        tipo: "opcoes",
        opcoes: opcoes(
          ["ambiente", "Ambiente"],
          ["refrigerado", "Refrigerado (2 a 8 °C)"],
          ["congelado", "Congelado"],
        ),
      },
    ],
  },
  lavarapido: {
    rotulo: "Lava-Rápido",
    campos: [
      {
        chave: "tipo",
        rotulo: "Tipo do produto",
        tipo: "opcoes",
        obrigatorio: true,
        opcoes: opcoes(["insumo", "Insumo de uso interno"], ["revenda", "Produto para revenda"]),
        ajuda:
          "Insumo é o que se gasta nas lavagens (shampoo, cera). Serviços se cadastram em Serviços e preços.",
      },
      {
        chave: "rendimento_lavagens",
        rotulo: "Rendimento (lavagens por embalagem)",
        tipo: "numero",
      },
      {
        chave: "perigoso",
        rotulo: "Produto perigoso",
        tipo: "booleano",
        ajuda: "Inflamável, corrosivo ou que pede cuidado no armazenamento.",
      },
    ],
  },
};

/** Módulos da empresa com cadastro de produto próprio, na ordem em que aparecem na escolha. */
export const MODULOS = Object.keys(MODULOS_PRODUTO) as ModuloProduto[];

/** O ramo de atividade da empresa é um dos quatro módulos? Qualquer outro ramo segue com o cadastro padrão. */
export function moduloDoRamo(ramo: string | null | undefined): ModuloProduto | null {
  return (MODULOS as string[]).includes(ramo ?? "") ? (ramo as ModuloProduto) : null;
}

export function camposDoModulo(ramo: string | null | undefined): readonly CampoModulo[] {
  const m = moduloDoRamo(ramo);
  return m ? MODULOS_PRODUTO[m].campos : [];
}

export type DadosModulo = Record<string, string | number | boolean>;

/** Valor vazio para o formulário: texto vazio em tudo, exceto sim/não (falso). */
export function dadosVazios(ramo: string | null | undefined): Record<string, string | boolean> {
  return Object.fromEntries(
    camposDoModulo(ramo).map((c) => [c.chave, c.tipo === "booleano" ? false : ""]),
  );
}

/** Lê o que veio do banco (jsonb) para o formulário: só as chaves do módulo, no tipo certo. */
export function dadosParaFormulario(
  ramo: string | null | undefined,
  bruto: unknown,
): Record<string, string | boolean> {
  const base = dadosVazios(ramo);
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return base;
  const origem = bruto as Record<string, unknown>;
  for (const c of camposDoModulo(ramo)) {
    const v = origem[c.chave];
    if (v === undefined || v === null) continue;
    base[c.chave] =
      c.tipo === "booleano"
        ? v === true
        : c.tipo === "numero"
          ? String(v).replace(".", ",")
          : String(v);
  }
  return base;
}

function lerNumero(txt: string): number | null {
  const n = Number(txt.trim().replace(",", "."));
  return txt.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** Mensagens de erro do formulário (obrigatórios, números e valores de lista). Vazio = pode salvar. */
export function errosDoModulo(
  ramo: string | null | undefined,
  form: Record<string, string | boolean>,
): string[] {
  const erros: string[] = [];
  for (const c of camposDoModulo(ramo)) {
    const v = form[c.chave];
    if (c.tipo === "booleano") continue;
    const txt = typeof v === "string" ? v.trim() : "";
    if (txt === "") {
      if (c.obrigatorio) erros.push(`Informe: ${c.rotulo}`);
      continue;
    }
    if (c.tipo === "numero") {
      const n = lerNumero(txt);
      if (n === null || n < 0) erros.push(`${c.rotulo}: informe um número válido`);
    }
    if (c.tipo === "opcoes" && !c.opcoes?.some((o) => o.valor === txt))
      erros.push(`${c.rotulo}: valor inválido`);
    if (c.tipo === "texto" && txt.length > 120) erros.push(`${c.rotulo}: até 120 caracteres`);
  }
  return erros;
}

/** O que vai para o banco: só as chaves do módulo, sem vazios; sim/não só quando marcado. */
export function dadosParaSalvar(
  ramo: string | null | undefined,
  form: Record<string, string | boolean>,
): DadosModulo {
  const out: DadosModulo = {};
  for (const c of camposDoModulo(ramo)) {
    const v = form[c.chave];
    if (c.tipo === "booleano") {
      if (v === true) out[c.chave] = true;
      continue;
    }
    const txt = typeof v === "string" ? v.trim() : "";
    if (txt === "") continue;
    if (c.tipo === "numero") {
      const n = lerNumero(txt);
      if (n !== null) out[c.chave] = n;
    } else out[c.chave] = txt;
  }
  return out;
}

/** Linha curta para a lista de produtos (ex.: "Cão · Adulto · Frango"). */
export function resumoDoModulo(ramo: string | null | undefined, bruto: unknown): string {
  const campos = camposDoModulo(ramo);
  if (!campos.length || !bruto || typeof bruto !== "object" || Array.isArray(bruto)) return "";
  const dados = bruto as Record<string, unknown>;
  const partes: string[] = [];
  for (const c of campos) {
    const v = dados[c.chave];
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (c.tipo === "booleano") partes.push(c.rotulo);
    else if (c.tipo === "opcoes") {
      const o = c.opcoes?.find((x) => x.valor === v)?.rotulo;
      // "Não", "Todas" e "Todos" não dizem nada na lista
      if (o && !["nao", "todas", "todos"].includes(String(v))) partes.push(o);
    } else if (c.tipo === "numero")
      partes.push(`${String(v).replace(".", ",")} ${c.chave.endsWith("_kg") ? "kg" : ""}`.trim());
    else partes.push(String(v));
  }
  return partes.join(" · ");
}

/** Clínica: medicamento e vacina pedem controle de lote e validade. */
export function exigeLote(
  ramo: string | null | undefined,
  dados: Record<string, string | boolean>,
): boolean {
  return (
    moduloDoRamo(ramo) === "clinica" &&
    (dados["tipo"] === "medicamento" || dados["tipo"] === "vacina")
  );
}
