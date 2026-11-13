import React, { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { useConsultaCep } from "../src/hooks/useConsultaCep";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Dados = { cep: string; endereco: string; bairro: string; cidade: string; estado: string; numero: string; complemento: string };
const vazio: Dados = { cep: "", endereco: "", bairro: "", cidade: "", estado: "", numero: "20", complemento: "Sala 2" };
let renderer: ReactTestRenderer | undefined;
let atualizar: React.Dispatch<React.SetStateAction<Dados>>;
let observado: Dados;
function Cadastro({ aberto = true, cadastro }: { aberto?: boolean; cadastro?: string }) {
  const [dados, setDados] = useState(vazio);
  atualizar = setDados;
  observado = dados;
  useConsultaCep(dados, setDados, aberto, cadastro);
  return null;
}
async function abrir() {
  vi.useFakeTimers();
  await act(async () => { renderer = create(<Cadastro />); });
}
async function digitar(cep: string) {
  await act(async () => { atualizar((dados) => ({ ...dados, cep })); });
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("consulta automaticamente ao completar oito números e preenche os quatro campos", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP" }) }));
  vi.stubGlobal("fetch", fetch);
  await abrir();
  await digitar("01001");
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(fetch).not.toHaveBeenCalled();
  await digitar("01001-000");
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(fetch).toHaveBeenCalledWith("https://viacep.com.br/ws/01001000/json/", expect.anything());
  expect(observado).toEqual({ ...vazio, cep: "01001-000", endereco: "Praça da Sé", bairro: "Sé", cidade: "São Paulo", estado: "SP" });
});

it("ignora resposta antiga quando o CEP muda", async () => {
  let responder: ((value: unknown) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { responder = resolve; })));
  await abrir();
  await digitar("01001000");
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await digitar("14015020");
  await act(async () => { responder?.({ ok: true, json: async () => ({ logradouro: "Praça da Sé", localidade: "São Paulo", uf: "SP" }) }); });
  expect(observado.cep).toBe("14015020");
  expect(observado.endereco).toBe("");
});

it("fechar o cadastro cancela a consulta pendente", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await abrir();
  await digitar("01001000");
  await act(async () => { renderer?.update(<Cadastro aberto={false} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(fetch).not.toHaveBeenCalled();
});

const salvo: Dados = { ...vazio, cep: "14800000", endereco: "Rua cadastrada", bairro: "Bairro cadastrado", cidade: "Araraquara", estado: "SP" };

it("abrir e reabrir um cliente com CEP salvo não consulta nem altera seu endereço", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ logradouro: "", bairro: "", localidade: "Araraquara", uf: "SP" }) }));
  vi.stubGlobal("fetch", fetch);
  vi.useFakeTimers();
  await act(async () => { renderer = create(<Cadastro aberto={false} />); });
  await act(async () => { atualizar(salvo); renderer?.update(<Cadastro cadastro="cliente-1" />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(fetch).not.toHaveBeenCalled();
  expect(observado).toEqual(salvo);
  await act(async () => { renderer?.update(<Cadastro aberto={false} cadastro="cliente-1" />); });
  await act(async () => { renderer?.update(<Cadastro cadastro="cliente-1" />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(fetch).not.toHaveBeenCalled();
  expect(observado).toEqual(salvo);
});

it("trocar o cliente em edição não consulta o CEP carregado", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await abrir();
  await act(async () => { atualizar(salvo); renderer?.update(<Cadastro cadastro="cliente-1" />); });
  await act(async () => { atualizar({ ...salvo, cep: "01001000" }); renderer?.update(<Cadastro cadastro="cliente-2" />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(fetch).not.toHaveBeenCalled();
  expect(observado.endereco).toBe("Rua cadastrada");
});

it("alterar o CEP de um cliente consulta e preenche o novo endereço", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP" }) }));
  vi.stubGlobal("fetch", fetch);
  await abrir();
  await act(async () => { atualizar(salvo); renderer?.update(<Cadastro cadastro="cliente-1" />); });
  await digitar("01001000");
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(observado).toEqual({ ...salvo, cep: "01001000", endereco: "Praça da Sé", bairro: "Sé", cidade: "São Paulo" });
});