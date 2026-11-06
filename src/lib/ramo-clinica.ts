// Empresa que é só clínica veterinária: o menu esconde o que é de outros ramos (obras, frota própria, vendedor comissionado).
// Estoque e compras ficam: vacinas e medicamentos entram por lote no estoque, e a clínica compra os insumos.
import {
  MARCADOR_SEM_PETSHOP,
  cnaesDaEmpresa,
  semCnpj,
  type EmpresaModulos,
} from "./cnae-regras.ts";

/** Liberação que é de outro ramo (a clínica, o pet shop e o marcador "sem pet shop" não contam). */
const ehOutroModulo = (m: string) =>
  m !== "clinica" && m !== "petshop" && m !== MARCADOR_SEM_PETSHOP;

/**
 * Itens da área Pet shop que a clínica sem pet shop mantém, porque a clínica depende deles: cadastro de pets e tutores, contatos,
 * serviços e preços (consulta, vacina e exame), profissionais (veterinário com CRMV), agenda e campos personalizados do pet.
 * Ficam bloqueados só os de banho e tosa: Ordens de serviço, Pacotes e Comissões. As páginas usam o mesmo critério (petShopOuClinica).
 */
export const ITENS_PET_DA_CLINICA = [
  "/pets",
  "/pet-contatos",
  "/pet-servicos",
  "/pet-profissionais",
  "/pet-agenda",
  "/pet-campos",
] as const;

/**
 * Nome da única área do menu do veterinário e do profissional: "Clínica" quando a empresa tem a clínica e não o pet shop
 * (contrato só clínica); nas demais, "Pet shop", como sempre foi.
 */
export const rotuloAreaProfissional = (
  clinica: boolean,
  petshop: boolean,
): "Clínica" | "Pet shop" => (clinica && !petshop ? "Clínica" : "Pet shop");

/** Item da área Pet shop aparece? Com o pet shop contratado, todos; sem ele (só clínica), apenas os que a clínica usa. */
export function itemPetVisivel(to: string | undefined, petshopLiberado: boolean): boolean {
  return petshopLiberado || (ITENS_PET_DA_CLINICA as readonly (string | undefined)[]).includes(to);
}

/**
 * Liberação explícita de outro módulo desfaz o "só clínica". A empresa é só clínica quando o ramo é clínica, o CNAE principal é de atividades veterinárias (7500) ou, sem CNPJ, a clínica foi
 * escolhida em "Módulos sem CNPJ" sem assistência técnica, locação ou restaurante.
 */
export function ehEmpresaSoClinica(empresa?: EmpresaModulos | null): boolean {
  if (!empresa) return false;
  // liberação explícita da Ze Tech de outro módulo (obras, assistência, locação…) vale mais que o ramo: a empresa não é só clínica
  if ((empresa.modulos_liberados ?? []).some(ehOutroModulo)) return false;
  if (empresa.ramo_atividade === "clinica") return true;
  if (cnaesDaEmpresa({ cnae: empresa.cnae ?? null })[0]?.startsWith("7500")) return true;
  const escolhidos = empresa.modulos_sem_cnpj ?? [];
  return (
    semCnpj(empresa) &&
    escolhidos.includes("clinica") &&
    !["assistencia", "locacao", "restaurante", "lavarapido", "hotelaria"].some((m) =>
      escolhidos.includes(m),
    )
  );
}

/** Telas que não fazem sentido para quem só tem clínica. */
export const TELAS_FORA_DA_CLINICA = [
  // obras e construção
  "/clientes-obras",
  "/obras",
  "/obra-historico",
  "/profissionais",
  // fábrica sob medida
  "/personalizacao",
  "/producao",
  "/custo-par",
  "/movimento-grade",
  // frota própria
  "/entregas",
  "/rota",
  "/entregas-motorista",
  "/frota-mapa",
  "/motorista",
  "/veiculos",
  "/motoristas",
  "/importar-cte",
  // estoque sem internet (a clínica tem o próprio trabalho sem internet)
  "/lotes-offline",
  "/conferencia-offline",
  // venda com vendedor comissionado
  "/vendedores",
  "/comissoes",
  "/relatorio-comissoes",
] as const;

/** Grupos inteiros que somem do menu de quem só tem clínica. */
export const GRUPOS_FORA_DA_CLINICA = ["Logística"] as const;

/** Nome da tela de lotes para a clínica: ali ficam os lotes de vacina e medicamento (validade e saldo). */
export const ROTULO_LOTES_CLINICA = "Lotes (vacinas e medicamentos)";

/**
 * Clínica veterinária ou pet shop: o dashboard mostra agenda, atendimentos e retorno dos clientes em vez de pedidos e entregas.
 * Vale para quem é só clínica, para o ramo ou o CNAE principal de pet shop, e para a liberação do módulo de pet shop ou clínica (explícita ou,
 * sem CNPJ, escolhida em Módulos sem CNPJ) quando não há outro módulo liberado. CNAE de pet shop só como secundário não conta: a empresa
 * que tem outra atividade principal continua com o dashboard de vendas.
 */
export function ehEmpresaPet(empresa?: EmpresaModulos | null): boolean {
  if (!empresa) return false;
  if (ehEmpresaSoClinica(empresa)) return true;
  const liberados = empresa.modulos_liberados ?? [];
  if (liberados.some(ehOutroModulo)) return false;
  if (liberados.includes("petshop") || liberados.includes("clinica")) return true;
  const escolhidos = semCnpj(empresa) ? (empresa.modulos_sem_cnpj ?? []) : [];
  if (
    escolhidos.includes("petshop") &&
    !["assistencia", "locacao", "restaurante", "lavarapido", "hotelaria"].some((m) =>
      escolhidos.includes(m),
    )
  )
    return true;
  if (empresa.ramo_atividade === "petshop") return true;
  return cnaesDaEmpresa({ cnae: empresa.cnae ?? null })[0]?.startsWith("4789004") ?? false;
}
