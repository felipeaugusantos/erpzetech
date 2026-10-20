import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FOLGA_ARMAZENAMENTO_BYTES,
  LIMITE_ANEXOS_POR_ALVO,
  LIMITE_PENDENTE_BYTES,
  anexosPendentesDoAlvo,
  bytesPendentes,
  enviarAnexo,
  erroDoAnexoLocal,
  mensagemDeGravacao,
  operacaoDeAnexo,
  type AlvoAnexo,
  type DependenciasAnexo,
  type PayloadAnexo,
} from "../src/lib/anexo-offline.ts";

const MB = 1024 * 1024;
const arq = (tam = MB, nome = "eco.jpg", type = "image/jpeg") => ({ name: nome, size: tam, type });
const atend: AlvoAnexo = { tipo: "atendimento", id: "11111111-1111-1111-1111-111111111111" };
const exame: AlvoAnexo = { tipo: "exame", abrirOpId: "22222222-2222-2222-2222-222222222222" };
const op = (alvo: AlvoAnexo, tam = MB, id?: string) =>
  operacaoDeAnexo(
    alvo,
    { categoria: "imagem", descricao: " Ultrassom ", arquivo: arq(tam) },
    "Rex",
    id,
  );

describe("operacaoDeAnexo", () => {
  it("guarda só os dados do anexo e aponta para o atendimento", () => {
    const o = operacaoDeAnexo(
      atend,
      {
        categoria: "laudo",
        descricao: " Laudo ",
        arquivo: arq(2048, "l.pdf", ""),
        dependeDe: ["x"],
      },
      "Rex",
    );
    assert.equal(o.tipo, "anexo_enviar");
    assert.deepEqual(o.dependeDe, ["x"]);
    assert.deepEqual((o.payload as PayloadAnexo).dados, {
      categoria: "laudo",
      descricao: "Laudo",
      nome_arquivo: "l.pdf",
      mime: "application/pdf",
      tamanho: 2048,
      atendimento_id: atend.id,
    });
  });

  it("anexo de exame aponta para a chave da abertura", () => {
    const d = (op(exame).payload as PayloadAnexo).dados;
    assert.equal(d.exame_abrir_chave, exame.abrirOpId);
    assert.equal("atendimento_id" in d, false);
  });

  it("recusa formato desconhecido", () => {
    assert.throws(
      () =>
        operacaoDeAnexo(
          atend,
          { categoria: "imagem", descricao: "x", arquivo: arq(10, "a.gif", "image/gif") },
          "Rex",
        ),
      /Formato/,
    );
  });
});

describe("limites locais", () => {
  it("aceita arquivo válido numa fila vazia", () => {
    assert.equal(erroDoAnexoLocal(arq(), { fila: [], alvo: atend }), null);
  });

  it("repete as regras do banco (formato e 15 MB)", () => {
    assert.match(erroDoAnexoLocal(arq(16 * MB), { fila: [], alvo: atend }) ?? "", /15 MB/);
    assert.match(
      erroDoAnexoLocal(arq(MB, "a.gif", "image/gif"), { fila: [], alvo: atend }) ?? "",
      /Formato/,
    );
  });

  it("limita 20 pendentes por alvo, sem contar os de outro alvo", () => {
    const fila = Array.from({ length: LIMITE_ANEXOS_POR_ALVO }, () => op(atend, 1000));
    assert.match(erroDoAnexoLocal(arq(1000), { fila, alvo: atend }) ?? "", /20 anexos/);
    assert.equal(erroDoAnexoLocal(arq(1000), { fila, alvo: exame }), null);
    assert.equal(anexosPendentesDoAlvo(fila, exame).length, 0);
  });

  it("limita o total esperando envio", () => {
    const fila = [op(atend, 15 * MB), op(exame, 15 * MB), op(atend, 15 * MB)];
    assert.equal(bytesPendentes(fila), 45 * MB);
    const cheia = Array.from({ length: 10 }, (_, i) =>
      op({ tipo: "exame", abrirOpId: `e${i}` }, 15 * MB),
    );
    assert.equal(bytesPendentes(cheia), LIMITE_PENDENTE_BYTES);
    assert.match(erroDoAnexoLocal(arq(1000), { fila: cheia, alvo: atend }) ?? "", /passam de/);
  });

  it("confere o espaço que o navegador informa, com folga", () => {
    const pouco = { quota: 100 * MB, usage: 100 * MB - 5 * MB };
    assert.match(
      erroDoAnexoLocal(arq(MB), { fila: [], alvo: atend, estimativa: pouco }) ?? "",
      /espaço/,
    );
    const bastante = { quota: 1000 * MB, usage: 0 };
    assert.equal(erroDoAnexoLocal(arq(MB), { fila: [], alvo: atend, estimativa: bastante }), null);
    const justo = { quota: 10 * MB + FOLGA_ARMAZENAMENTO_BYTES, usage: 0 };
    assert.equal(
      erroDoAnexoLocal(arq(10 * MB), { fila: [], alvo: atend, estimativa: justo }),
      null,
    );
    // navegador que não informa: segue
    assert.equal(erroDoAnexoLocal(arq(MB), { fila: [], alvo: atend, estimativa: {} }), null);
  });

  it("traduz a falta de espaço na gravação", () => {
    const e = new Error("x");
    e.name = "QuotaExceededError";
    assert.match(mensagemDeGravacao(e), /não tem mais espaço/);
    assert.equal(mensagemDeGravacao(new Error("outro")), "outro");
  });
});

function ambiente(sobrescrever: Partial<DependenciasAnexo> = {}) {
  const chamadas: string[] = [];
  const arquivos = new Map<string, ArrayBuffer>([["k", new ArrayBuffer(8)]]);
  const dep: DependenciasAnexo = {
    preparar: async () => {
      chamadas.push("preparar");
      return { anexo_id: "A1", caminho: "t/p/A1.jpg", situacao: "pendente" };
    },
    enviarArquivo: async () => {
      chamadas.push("enviar");
      return null;
    },
    confirmar: async () => {
      chamadas.push("confirmar");
      return null;
    },
    lerArquivo: async (c) => arquivos.get(c),
    apagarArquivo: async (c) => {
      chamadas.push("apagar");
      arquivos.delete(c);
    },
    ...sobrescrever,
  };
  return { dep, chamadas, arquivos };
}
const payload = op(atend).payload as PayloadAnexo;

describe("enviarAnexo", () => {
  it("reserva, envia, confirma e só então apaga o arquivo do cofre", async () => {
    const { dep, chamadas, arquivos } = ambiente();
    await enviarAnexo(dep, payload, "k");
    assert.deepEqual(chamadas, ["preparar", "enviar", "confirmar", "apagar"]);
    assert.equal(arquivos.has("k"), false);
  });

  it("anexo já confirmado antes: não envia de novo e solta o arquivo", async () => {
    const { dep, chamadas } = ambiente({
      preparar: async () => ({ anexo_id: "A1", caminho: "c", situacao: "ativo" }),
    });
    await enviarAnexo(dep, payload, "k");
    assert.deepEqual(chamadas, ["apagar"]);
  });

  it("falha de conexão no envio deixa o arquivo no cofre", async () => {
    const { dep, arquivos } = ambiente({
      enviarArquivo: async () => "Failed to fetch",
      confirmar: async () => "Failed to fetch",
    });
    await assert.rejects(() => enviarAnexo(dep, payload, "k"), /Failed to fetch/);
    assert.equal(arquivos.has("k"), true);
  });

  it("envio que já tinha chegado: o erro do envio é ignorado e a confirmação resolve", async () => {
    const { dep, chamadas, arquivos } = ambiente({
      enviarArquivo: async () => "The resource already exists",
    });
    await enviarAnexo(dep, payload, "k");
    assert.deepEqual(chamadas, ["preparar", "confirmar", "apagar"]);
    assert.equal(arquivos.has("k"), false);
  });

  it("confirmação duplicada vale como enviado", async () => {
    const { dep, arquivos } = ambiente({ confirmar: async () => "Este anexo já foi confirmado" });
    await enviarAnexo(dep, payload, "k");
    assert.equal(arquivos.has("k"), false);
  });

  it("recusa na confirmação mantém o arquivo e propaga o motivo", async () => {
    const { dep, arquivos } = ambiente({
      confirmar: async () => "O arquivo enviado não confere com o informado: envie de novo",
    });
    await assert.rejects(() => enviarAnexo(dep, payload, "k"), /não confere/);
    assert.equal(arquivos.has("k"), true);
  });

  it("arquivo ausente do cofre é recusa explicada, não envio vazio", async () => {
    const { dep, chamadas } = ambiente();
    await assert.rejects(() => enviarAnexo(dep, payload, "sem-arquivo"), /não está mais no cofre/);
    assert.equal(chamadas.includes("enviar"), false);
  });

  it("recusa do banco na reserva propaga", async () => {
    const { dep } = ambiente({
      preparar: async () => {
        throw new Error("Limite de 20 anexos por exame ou atendimento");
      },
    });
    await assert.rejects(() => enviarAnexo(dep, payload, "k"), /Limite de 20/);
  });
});
