// Exame sem internet: o rascunho guardado no cofre (modelo, valores) e as operações da fila (abrir, salvar, fechar). O id do exame nasce
// no banco; a chave da operação de abrir é o "id local" e as seguintes apontam para ela. Os resultados vão pelo campo do modelo.
import { numeroOuNulo, type CampoExame } from "./exames.ts";
import { novaOperacao, type OperacaoFila } from "./fila-clinica.ts";

export const TIPO_EXAME_ABRIR = "exame_abrir";
export const TIPO_EXAME_SALVAR = "exame_salvar";
export const TIPO_EXAME_FECHAR = "exame_fechar";

/** Prefixo da chave do rascunho do exame na loja "copia" do cofre. */
export const PREFIXO_EXAME = "exame:";

export type ModeloLocal = {
  id: string;
  nome: string;
  tipo: string;
  material: string | null;
  campos: CampoExame[];
};

export type ValorLocal = { valor: string; nota: string };

export type FormExame = {
  laboratorio: string;
  material: string;
  dataColeta: string;
  observacoes: string;
  /** Por id do campo do modelo. */
  valores: Record<string, ValorLocal>;
};

export type RascunhoExame = {
  /** Chave da operação que abre o exame: serve de id local. */
  abrirOpId: string;
  petId: string;
  petNome: string;
  tutorNome: string;
  especie: string;
  atendimentoId: string | null;
  modelo: ModeloLocal;
  criadoEm: string;
  form: FormExame;
  fechado: boolean;
};

/** Modelos ativos da cópia, só com os campos ativos, prontos para preencher. */
export function modelosDaCopia(copia: { dados: { modelos_exame: unknown[] } }): ModeloLocal[] {
  const lista: ModeloLocal[] = [];
  for (const bruto of copia.dados.modelos_exame) {
    const m = bruto as Partial<ModeloLocal> & { ativo?: boolean };
    if (!m || typeof m.id !== "string" || typeof m.nome !== "string" || m.ativo === false) continue;
    const campos = (Array.isArray(m.campos) ? m.campos : []).filter((c) => c.ativo !== false);
    if (campos.length === 0) continue;
    lista.push({
      id: m.id,
      nome: m.nome,
      tipo: String(m.tipo ?? "outro"),
      material: m.material ?? null,
      campos,
    });
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** O que a pessoa digita nos campos que ela mesma preenche (o calculado só existe depois do envio). */
export const camposPreenchidos = (m: Pick<ModeloLocal, "campos">): CampoExame[] =>
  m.campos.filter((c) => c.forma !== "calculado");

export type DadosDaAbertura = {
  laboratorio: string;
  material: string;
  dataColeta: string;
  atendimentoId: string | null;
};

export function erroDaAbertura(d: DadosDaAbertura, hoje: string): string | null {
  if (!d.atendimentoId && !d.laboratorio.trim())
    return "Exame sem atendimento aberto precisa do nome do laboratório";
  if (d.laboratorio.trim().length > 120) return "O nome do laboratório passa de 120 letras";
  if (d.material.trim().length > 80) return "O material passa de 80 letras";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dataColeta)) return "Informe a data da coleta";
  if (d.dataColeta > hoje) return "A data da coleta não pode ser no futuro";
  return null;
}

export function abrirExame(
  paciente: {
    petId: string;
    petNome: string;
    tutorNome: string;
    especie: string;
    cadastroOpId?: string;
  },
  modelo: ModeloLocal,
  dados: DadosDaAbertura,
  /** Operação que abre o atendimento ao qual o exame pertence, se ainda estiver na fila. */
  registrarOpId?: string,
  agora: Date = new Date(),
  id?: string,
): { rascunho: RascunhoExame; operacao: OperacaoFila } {
  const payload: Record<string, string> = {
    pet_id: paciente.petId,
    modelo_id: modelo.id,
    data_coleta: dados.dataColeta,
  };
  if (dados.atendimentoId) payload["atendimento_id"] = dados.atendimentoId;
  if (dados.laboratorio.trim()) payload["laboratorio"] = dados.laboratorio.trim();
  if (dados.material.trim()) payload["material"] = dados.material.trim();
  const dependeDe = [paciente.cadastroOpId, registrarOpId].filter((x): x is string => !!x);
  const operacao = novaOperacao(
    {
      tipo: TIPO_EXAME_ABRIR,
      descricao: `Abrir exame: ${modelo.nome} em ${paciente.petNome} (tutor ${paciente.tutorNome})`,
      payload,
      dependeDe,
    },
    id,
    agora,
  );
  return {
    operacao,
    rascunho: {
      abrirOpId: operacao.id,
      petId: paciente.petId,
      petNome: paciente.petNome,
      tutorNome: paciente.tutorNome,
      especie: paciente.especie,
      atendimentoId: dados.atendimentoId,
      modelo,
      criadoEm: agora.toISOString(),
      form: {
        laboratorio: dados.laboratorio.trim(),
        material: dados.material.trim(),
        dataColeta: dados.dataColeta,
        observacoes: "",
        valores: {},
      },
      fechado: false,
    },
  };
}

/** Confere os valores com as regras do banco; devolve a mensagem do primeiro problema. */
export function erroDoExame(f: FormExame, modelo: Pick<ModeloLocal, "campos">): string | null {
  if (f.observacoes.length > 4000) return "As observações passam de 4000 letras";
  for (const c of camposPreenchidos(modelo)) {
    const v = f.valores[c.id];
    if (!v) continue;
    if (v.nota.length > 1000) return `"${c.nome}": nota grande demais (até 1000 caracteres)`;
    if (c.forma === "numero") {
      const n = numeroOuNulo(v.valor);
      if (n !== null && (!Number.isFinite(n) || n < 0 || n >= 1e12))
        return `Digite só números em "${c.nome}"`;
    } else if (v.valor.length > 2000)
      return `"${c.nome}": texto grande demais (até 2000 caracteres)`;
    else if (c.forma === "escolha" && v.valor && !(c.opcoes ?? []).includes(v.valor))
      return `"${c.nome}": escolha uma das opções da lista`;
  }
  return null;
}

/** O banco só fecha o exame com ao menos um resultado preenchido. */
export function temResultado(f: FormExame, modelo: Pick<ModeloLocal, "campos">): boolean {
  return camposPreenchidos(modelo).some((c) => (f.valores[c.id]?.valor ?? "").trim() !== "");
}

export function dadosParaSalvar(r: RascunhoExame, form: FormExame) {
  return {
    abrir_chave: r.abrirOpId,
    laboratorio: form.laboratorio,
    material: form.material,
    data_coleta: form.dataColeta,
    observacoes: form.observacoes,
    resultados: camposPreenchidos(r.modelo).map((c) => ({
      campo_id: c.id,
      valor: form.valores[c.id]?.valor ?? "",
      nota: form.valores[c.id]?.nota ?? "",
    })),
  };
}

type PayloadExame = { abrir_chave?: unknown; atendimento_id?: unknown };

const deste = (op: OperacaoFila, tipo: string, abrirOpId: string) =>
  op.tipo === tipo && (op.payload as PayloadExame | null)?.abrir_chave === abrirOpId;

/** Salvamentos pendentes do exame: o mais novo leva tudo, então os anteriores saem. */
export function salvamentosSubstituidosExame(
  fila: readonly OperacaoFila[],
  abrirOpId: string,
): string[] {
  return fila
    .filter((op) => deste(op, TIPO_EXAME_SALVAR, abrirOpId) && op.estado === "pendente")
    .map((op) => op.id);
}

export function operacaoDeSalvarExame(
  r: RascunhoExame,
  form: FormExame,
  agora: Date = new Date(),
  id?: string,
): OperacaoFila {
  return novaOperacao(
    {
      tipo: TIPO_EXAME_SALVAR,
      descricao: `Salvar exame: ${r.modelo.nome} de ${r.petNome}`,
      payload: dadosParaSalvar(r, form),
      dependeDe: [r.abrirOpId],
    },
    id,
    agora,
  );
}

export function operacaoDeFecharExame(
  r: RascunhoExame,
  salvarOpId: string,
  agora: Date = new Date(),
  id?: string,
): OperacaoFila {
  return novaOperacao(
    {
      tipo: TIPO_EXAME_FECHAR,
      descricao: `Fechar exame: ${r.modelo.nome} de ${r.petNome}`,
      payload: { abrir_chave: r.abrirOpId },
      dependeDe: [r.abrirOpId, salvarOpId],
    },
    id,
    agora,
  );
}

/** Operações de abrir exame ainda na fila que pertencem ao atendimento (o atendimento só fecha depois delas). */
export function aberturasDoAtendimento(
  fila: readonly OperacaoFila[],
  atendimentoId: string,
): string[] {
  return fila
    .filter(
      (op) =>
        op.tipo === TIPO_EXAME_ABRIR &&
        (op.payload as PayloadExame | null)?.atendimento_id === atendimentoId,
    )
    .map((op) => op.id);
}

/** O rascunho sai do cofre quando está fechado e nada dele resta na fila. */
export function exameJaEnviado(r: RascunhoExame, fila: readonly OperacaoFila[]): boolean {
  if (!r.fechado) return false;
  return !fila.some(
    (op) =>
      op.id === r.abrirOpId ||
      deste(op, TIPO_EXAME_SALVAR, r.abrirOpId) ||
      deste(op, TIPO_EXAME_FECHAR, r.abrirOpId),
  );
}
