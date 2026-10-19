import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  VALIDADE_ACESSO_DIAS,
  decidirAcesso,
  lerAcessoLocal,
  limparAcessoLocal,
  salvarAcessoLocal,
  type MiniArmazem,
} from "../src/lib/acesso-clinica.ts";

function falso(): MiniArmazem & { dados: Map<string, string> } {
  const dados = new Map<string, string>();
  return {
    dados,
    getItem: (k) => dados.get(k) ?? null,
    setItem: (k, v) => void dados.set(k, v),
    removeItem: (k) => void dados.delete(k),
  };
}

describe("acesso local da clínica", () => {
  const agora = new Date("2026-10-19T12:00:00Z");
  it("vale 7 dias, só para o mesmo usuário", () => {
    const a = falso();
    salvarAcessoLocal("u1", { clinica: true, veterinario: true }, agora, a);
    assert.equal(VALIDADE_ACESSO_DIAS, 7);
    assert.deepEqual(lerAcessoLocal("u1", new Date("2026-10-26T11:59:59Z"), a), {
      clinica: true,
      veterinario: true,
    });
    assert.equal(lerAcessoLocal("u1", new Date("2026-10-26T12:00:00Z"), a), null);
    assert.equal(lerAcessoLocal("u2", agora, a), null);
  });
  it("guarda só sins e nãos, sem dado da pessoa além do id", () => {
    const a = falso();
    salvarAcessoLocal("u1", { clinica: true, veterinario: false }, agora, a);
    const texto = [...a.dados.values()][0] as string;
    assert.deepEqual(Object.keys(JSON.parse(texto)).sort(), [
      "clinica",
      "userId",
      "validoAte",
      "veterinario",
    ]);
    assert.deepEqual(lerAcessoLocal("u1", agora, a), { clinica: true, veterinario: false });
  });
  it("limpar apaga; lixo no lugar não derruba", () => {
    const a = falso();
    salvarAcessoLocal("u1", { clinica: true, veterinario: true }, agora, a);
    limparAcessoLocal(a);
    assert.equal(lerAcessoLocal("u1", agora, a), null);
    a.setItem("zt-clinica-acesso", "{não é json");
    assert.equal(lerAcessoLocal("u1", agora, a), null);
    assert.equal(lerAcessoLocal("u1", agora, null), null);
  });
});

describe("decidirAcesso", () => {
  const base = {
    carregando: false,
    sessaoConfirmada: true,
    clinica: true,
    veterinario: true,
    local: null,
  };
  it("com a sessão conhecida, ela decide", () => {
    assert.equal(decidirAcesso(base), "liberado");
    assert.equal(decidirAcesso({ ...base, clinica: false }), "sem_clinica");
    assert.equal(decidirAcesso({ ...base, veterinario: false }), "sem_perfil");
    // o que foi guardado não passa por cima da sessão
    assert.equal(
      decidirAcesso({ ...base, veterinario: false, local: { clinica: true, veterinario: true } }),
      "sem_perfil",
    );
  });
  it("sem a sessão (sem sinal e cache vencido), vale o que foi guardado", () => {
    const semSessao = { ...base, sessaoConfirmada: false, clinica: false, veterinario: false };
    assert.equal(
      decidirAcesso({ ...semSessao, local: { clinica: true, veterinario: true } }),
      "liberado",
    );
    assert.equal(
      decidirAcesso({ ...semSessao, local: { clinica: true, veterinario: false } }),
      "sem_confirmacao",
    );
    assert.equal(decidirAcesso({ ...semSessao, local: null }), "sem_confirmacao");
  });
  it("enquanto carrega, espera", () => {
    assert.equal(
      decidirAcesso({ ...base, sessaoConfirmada: false, carregando: true }),
      "carregando",
    );
  });
});
