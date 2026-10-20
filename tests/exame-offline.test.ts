import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TIPO_EXAME_ABRIR,
  TIPO_EXAME_FECHAR,
  TIPO_EXAME_SALVAR,
  aberturasDoAtendimento,
  abrirExame,
  dadosParaSalvar,
  erroDaAbertura,
  erroDoExame,
  exameJaEnviado,
  modelosDaCopia,
  operacaoDeFecharExame,
  operacaoDeSalvarExame,
  salvamentosSubstituidosExame,
  temResultado,
  type FormExame,
} from "../src/lib/exame-offline.ts";
import { situacaoNaFila } from "../src/lib/fila-clinica.ts";

const hoje = "2026-10-20";
const agora = new Date("2026-10-20T12:00:00Z");
const campo = (id: string, forma: string, extra: object = {}) => ({
  id,
  ordem: 0,
  grupo: null,
  nome: `Campo ${id}`,
  unidade: null,
  forma,
  casas: null,
  opcoes: null,
  observacao: null,
  ativo: true,
  total_campo_id: null,
  pct_campo_id: null,
  referencias: [],
  ...extra,
});
const copia = {
  dados: {
    modelos_exame: [
      {
        id: "m1",
        nome: "Glicemia",
        tipo: "bioquimica",
        material: "Soro",
        ativo: true,
        campos: [
          campo("n", "numero"),
          campo("t", "texto"),
          campo("e", "escolha", { opcoes: ["Reagente", "Não reagente"] }),
          campo("c", "calculado"),
          campo("off", "numero", { ativo: false }),
        ],
      },
      { id: "m2", nome: "Inativo", ativo: false, campos: [campo("x", "numero")] },
      { id: "m3", nome: "Sem campos", ativo: true, campos: [] },
    ],
  },
};
const paciente = { petId: "p", petNome: "Rex", tutorNome: "Ana", especie: "cao" };
const vazio: FormExame = {
  laboratorio: "Lab",
  material: "Soro",
  dataColeta: hoje,
  observacoes: "",
  valores: {},
};

describe("modelosDaCopia", () => {
  it("só modelos ativos com campos ativos", () => {
    const r = modelosDaCopia(copia);
    assert.deepEqual(
      r.map((m) => m.id),
      ["m1"],
    );
    assert.deepEqual(
      r[0]?.campos.map((c) => c.id),
      ["n", "t", "e", "c"],
    );
  });
});

describe("abrir", () => {
  const [modelo] = modelosDaCopia(copia);
  it("exame sem atendimento exige laboratório; data não pode ser futura", () => {
    const base = { laboratorio: "", material: "", dataColeta: hoje, atendimentoId: null };
    assert.match(erroDaAbertura(base, hoje) ?? "", /laboratório/);
    assert.equal(erroDaAbertura({ ...base, atendimentoId: "a" }, hoje), null);
    assert.match(
      erroDaAbertura({ ...base, laboratorio: "L", dataColeta: "2026-10-21" }, hoje) ?? "",
      /futuro/,
    );
  });
  it("a operação leva o paciente e o modelo e espera cadastro e atendimento", () => {
    const { operacao, rascunho } = abrirExame(
      { ...paciente, cadastroOpId: "cad" },
      modelo!,
      { laboratorio: "", material: "", dataColeta: hoje, atendimentoId: "at" },
      "reg",
      agora,
    );
    assert.equal(operacao.tipo, TIPO_EXAME_ABRIR);
    assert.deepEqual(operacao.dependeDe, ["cad", "reg"]);
    const p = operacao.payload as Record<string, string>;
    assert.equal(p["atendimento_id"], "at");
    assert.equal(p["laboratorio"], undefined);
    assert.equal(rascunho.abrirOpId, operacao.id);
  });
});

describe("preencher", () => {
  const [modelo] = modelosDaCopia(copia);
  const { rascunho, operacao: abrir } = abrirExame(
    paciente,
    modelo!,
    { laboratorio: "Lab", material: "", dataColeta: hoje, atendimentoId: null },
    undefined,
    agora,
  );
  it("confere números, texto e escolha", () => {
    assert.equal(erroDoExame(vazio, modelo!), null);
    const com = (id: string, valor: string, nota = ""): FormExame => ({
      ...vazio,
      valores: { [id]: { valor, nota } },
    });
    assert.match(erroDoExame(com("n", "abc"), modelo!) ?? "", /só números/);
    assert.equal(erroDoExame(com("n", "92,5"), modelo!), null);
    assert.match(erroDoExame(com("e", "Talvez"), modelo!) ?? "", /opções/);
    assert.match(erroDoExame(com("t", "x", "n".repeat(1001)), modelo!) ?? "", /nota/);
  });
  it("só fecha com um resultado preenchido (calculado não conta)", () => {
    assert.equal(temResultado(vazio, modelo!), false);
    assert.equal(
      temResultado({ ...vazio, valores: { c: { valor: "5", nota: "" } } }, modelo!),
      false,
    );
    assert.equal(
      temResultado({ ...vazio, valores: { n: { valor: "5", nota: "" } } }, modelo!),
      true,
    );
  });
  it("salvar manda os campos do modelo (sem o calculado) e espera a abertura", () => {
    const form = { ...vazio, valores: { n: { valor: "92,5", nota: "" } } };
    const s = operacaoDeSalvarExame(rascunho, form, agora);
    assert.equal(s.tipo, TIPO_EXAME_SALVAR);
    assert.deepEqual(s.dependeDe, [abrir.id]);
    const d = dadosParaSalvar(rascunho, form);
    assert.deepEqual(
      d.resultados.map((r) => r.campo_id),
      ["n", "t", "e"],
    );
    assert.equal(d.abrir_chave, abrir.id);
    assert.equal(d.resultados[0]?.valor, "92,5");
  });
  it("só os salvamentos pendentes do mesmo exame são substituídos", () => {
    const a = operacaoDeSalvarExame(rascunho, vazio, agora);
    const b = { ...operacaoDeSalvarExame(rascunho, vazio, agora), estado: "recusada" as const };
    const outro = operacaoDeSalvarExame({ ...rascunho, abrirOpId: "outro" }, vazio, agora);
    assert.deepEqual(salvamentosSubstituidosExame([abrir, a, b, outro], rascunho.abrirOpId), [
      a.id,
    ]);
  });
  it("fechar espera a abertura e o último salvamento", () => {
    const s = operacaoDeSalvarExame(rascunho, vazio, agora);
    const f = operacaoDeFecharExame(rascunho, s.id, agora);
    assert.equal(f.tipo, TIPO_EXAME_FECHAR);
    assert.equal(situacaoNaFila(f, [abrir, s, f]), "aguardando");
    assert.equal(situacaoNaFila(f, [abrir, { ...s, estado: "recusada" }, f]), "bloqueada");
  });
  it("rascunho fechado some quando nada dele resta na fila", () => {
    const s = operacaoDeSalvarExame(rascunho, vazio, agora);
    assert.equal(exameJaEnviado({ ...rascunho, fechado: false }, []), false);
    assert.equal(exameJaEnviado({ ...rascunho, fechado: true }, [s]), false);
    assert.equal(exameJaEnviado({ ...rascunho, fechado: true }, []), true);
  });
});

describe("aberturasDoAtendimento", () => {
  it("lista as aberturas pendentes do atendimento", () => {
    const [modelo] = modelosDaCopia(copia);
    const a = abrirExame(
      paciente,
      modelo!,
      { laboratorio: "", material: "", dataColeta: hoje, atendimentoId: "at" },
      undefined,
      agora,
    ).operacao;
    const b = abrirExame(
      paciente,
      modelo!,
      { laboratorio: "L", material: "", dataColeta: hoje, atendimentoId: null },
      undefined,
      agora,
    ).operacao;
    assert.deepEqual(aberturasDoAtendimento([a, b], "at"), [a.id]);
  });
});
