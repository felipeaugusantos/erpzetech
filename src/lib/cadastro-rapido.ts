// Cadastro rápido de tutor e pet pelo veterinário, feito sem internet: regras do formulário (as mesmas do banco), a operação que vai para a
// fila e os pacientes que ainda só existem no notebook. Os identificadores nascem aqui, para o pet novo já poder receber atendimento.
import { novaOperacao, type OperacaoFila } from "./fila-clinica.ts";

export const TIPO_CADASTRO_RAPIDO = "cadastro_rapido";

export const ESPECIES_CADASTRO = [
  { value: "cao", label: "Cão" },
  { value: "gato", label: "Gato" },
] as const;

export type FormCadastroRapido = {
  /** Id de um tutor que já existe (da agenda baixada) ou vazio para um tutor novo. */
  tutorId: string;
  tutorNome: string;
  tutorTelefone: string;
  petNome: string;
  especie: "cao" | "gato";
  raca: string;
  sexo: "" | "macho" | "femea";
  nascimento: string;
  peso: string;
  castrado: "" | "sim" | "nao";
  alergias: string;
};

export const cadastroVazio: FormCadastroRapido = {
  tutorId: "",
  tutorNome: "",
  tutorTelefone: "",
  petNome: "",
  especie: "cao",
  raca: "",
  sexo: "",
  nascimento: "",
  peso: "",
  castrado: "",
  alergias: "",
};

/** Confere o formulário com as regras do banco; devolve a mensagem do primeiro problema. */
export function erroDoCadastroRapido(
  f: FormCadastroRapido,
  hoje: Date = new Date(),
): string | null {
  if (!f.tutorId) {
    const nome = f.tutorNome.trim();
    if (nome.length < 2 || nome.length > 120) return "Informe o nome do tutor (de 2 a 120 letras)";
    const fone = f.tutorTelefone.trim();
    if (fone) {
      const digitos = fone.replace(/\D/g, "");
      if (digitos.length < 10 || digitos.length > 13 || fone.length > 30)
        return "Telefone inválido: informe com DDD";
    }
  }
  const pet = f.petNome.trim();
  if (!pet || pet.length > 80) return "Informe o nome do pet (até 80 letras)";
  if (f.raca.trim().length > 60) return "A raça passa de 60 letras";
  if (f.alergias.trim().length > 1000) return "As alergias passam de 1000 letras";
  if (f.peso.trim()) {
    const p = Number(f.peso.trim().replace(",", "."));
    if (!Number.isFinite(p) || p <= 0 || p > 200) return "Peso fora do esperado (até 200 kg)";
  }
  if (f.nascimento) {
    const n = new Date(`${f.nascimento}T00:00:00`);
    if (Number.isNaN(n.getTime())) return "Confira a data de nascimento";
    if (n.getTime() > hoje.getTime()) return "O nascimento não pode ser no futuro";
  }
  return null;
}

export type CadastroRapidoPayload = {
  cliente_id?: string;
  cliente?: { id: string; nome: string; telefone?: string };
  pet: Record<string, unknown>;
};

/** A operação da fila: o id da operação é a chave de repetição; os ids do tutor e do pet nascem aqui. */
export function operacaoDoCadastroRapido(
  f: FormCadastroRapido,
  nomeDoTutorExistente?: string,
  ids: { operacao?: string; cliente?: string; pet?: string } = {},
  agora: Date = new Date(),
): OperacaoFila {
  const petId = ids.pet ?? crypto.randomUUID();
  const pet: Record<string, unknown> = { id: petId, nome: f.petNome.trim(), especie: f.especie };
  if (f.raca.trim()) pet["raca"] = f.raca.trim();
  if (f.sexo) pet["sexo"] = f.sexo;
  if (f.nascimento) pet["nascimento"] = f.nascimento;
  if (f.peso.trim()) pet["peso_kg"] = f.peso.trim().replace(",", ".");
  if (f.castrado) pet["castrado"] = f.castrado === "sim";
  if (f.alergias.trim()) pet["alergias"] = f.alergias.trim();

  let payload: CadastroRapidoPayload;
  let tutor: string;
  if (f.tutorId) {
    payload = { cliente_id: f.tutorId, pet };
    tutor = nomeDoTutorExistente ?? "tutor já cadastrado";
  } else {
    const cliente: { id: string; nome: string; telefone?: string } = {
      id: ids.cliente ?? crypto.randomUUID(),
      nome: f.tutorNome.trim(),
    };
    if (f.tutorTelefone.trim()) cliente.telefone = f.tutorTelefone.trim();
    payload = { cliente, pet };
    tutor = cliente.nome;
  }
  return novaOperacao(
    {
      tipo: TIPO_CADASTRO_RAPIDO,
      descricao: `Cadastro: ${f.petNome.trim()} (tutor ${tutor})`,
      payload,
    },
    ids.operacao,
    agora,
  );
}

export type PacienteLocal = {
  petId: string;
  petNome: string;
  especie: string;
  tutorId: string;
  tutorNome: string;
  /** Operação da fila que ainda vai criar este paciente (outras operações dependem dela). */
  operacaoId: string;
};

/** Pacientes cadastrados sem internet que ainda não foram enviados (para o atendimento da visita escolher). */
export function pacientesLocais(
  fila: readonly OperacaoFila[],
  tutoresConhecidos: Record<string, string> = {},
): PacienteLocal[] {
  const lista: PacienteLocal[] = [];
  for (const op of fila) {
    if (op.tipo !== TIPO_CADASTRO_RAPIDO) continue;
    const p = op.payload as CadastroRapidoPayload | null;
    if (!p?.pet || typeof p.pet["id"] !== "string") continue;
    const tutorId = p.cliente?.id ?? p.cliente_id;
    if (!tutorId) continue;
    lista.push({
      petId: p.pet["id"],
      petNome: String(p.pet["nome"] ?? ""),
      especie: String(p.pet["especie"] ?? "cao"),
      tutorId,
      tutorNome: p.cliente?.nome ?? tutoresConhecidos[tutorId] ?? "tutor já cadastrado",
      operacaoId: op.id,
    });
  }
  return lista;
}
