import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pet: "pet-a", resumir: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => ({ pet: state.pet }) }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/cnae", () => ({ useModulosCnae: () => ({ clinica: true, carregando: false }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => ({ data: "vet-a", error: null })) },
}));
vi.mock("@/lib/clinica-resumo-ia.functions", () => ({
  resumoIaLiberado: async () => true,
  resumirHistoricoClinico: state.resumir,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/app/DocumentosClinicos", () => ({ DocumentosClinicos: () => null }));
vi.mock("@/components/app/IniciarAtendimentoDialog", () => ({
  IniciarAtendimentoDialog: () => null,
}));
vi.mock("@/components/app/NovoPacienteDialog", () => ({ NovoPacienteDialog: () => null }));
vi.mock("@/components/app/ModuloCnae", () => ({ ModuloBloqueado: () => null }));

import { Route } from "../src/routes/_authenticated/clinica-prontuario";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const resultadoA = {
  vazio: false,
  resumo: {
    visao_geral: "Resumo exclusivo do animal A",
    alergias: "Alergia exclusiva do animal A",
    linha_do_tempo: [{ data: "2026-01-01", fato: "Consulta exclusiva do animal A" }],
    pendencias: [],
    faltou: null,
  },
};
let renderer: ReactTestRenderer | undefined;
let qc: QueryClient;
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};
const tree = () => {
  const Component = Route.options.component as React.ComponentType;
  return (
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>
  );
};
async function abrir() {
  state.pet = "pet-a";
  state.resumir.mockReset();
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(["clinica-resumo-ia-liberado"], true);
  qc.setQueryData(["clinica-meu-veterinario"], "vet-a");
  for (const id of ["pet-a", "pet-b"]) {
    qc.setQueryData(["clinica-historico", id], {
      pet: { id, nome: id, especie: "cao", alergias: `Alergia salva ${id}` },
      tutor: "Tutor fictício",
      atendimentos: [],
    });
  }
  await act(async () => {
    renderer = create(tree());
  });
  await flush();
}
async function trocar(pet: string) {
  state.pet = pet;
  await act(async () => {
    renderer?.update(tree());
  });
  await flush();
}
async function gerar() {
  const button = renderer?.root
    .findAllByType("button")
    .find((b) => b.children.includes("Resumir histórico"));
  if (!button) throw new Error("Resumo indisponível");
  await act(async () => {
    button.props.onClick();
  });
  await flush();
}
function conteudo() {
  return JSON.stringify(renderer?.toJSON());
}
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
  qc?.clear();
});

describe("Isolamento do prontuário por paciente", () => {
  it("não mostra resumo, alergia ou linha do tempo de A ao abrir B já em cache ou voltar", async () => {
    await abrir();
    state.resumir.mockResolvedValue(resultadoA);
    await gerar();
    expect(conteudo()).toContain(resultadoA.resumo.visao_geral);
    await trocar("pet-b");
    expect(conteudo()).toContain("pet-b");
    for (const trecho of [
      resultadoA.resumo.visao_geral,
      resultadoA.resumo.alergias,
      resultadoA.resumo.linha_do_tempo[0].fato,
    ]) {
      expect(conteudo()).not.toContain(trecho);
    }
    await trocar("pet-a");
    expect(conteudo()).not.toContain(resultadoA.resumo.visao_geral);
  });

  it("resposta atrasada de A não preenche B nem a nova abertura de A", async () => {
    await abrir();
    let resolver: ((value: typeof resultadoA) => void) | undefined;
    state.resumir.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );
    await gerar();
    expect(state.resumir).toHaveBeenCalledWith({ data: { petId: "pet-a" } });
    await trocar("pet-b");
    await trocar("pet-a");
    await act(async () => {
      resolver?.(resultadoA);
    });
    await flush();
    expect(conteudo()).not.toContain(resultadoA.resumo.visao_geral);
    await trocar("pet-b");
    expect(conteudo()).not.toContain(resultadoA.resumo.visao_geral);
  });

  it("descarta rascunho de alergia de A ao abrir a ficha em cache de B", async () => {
    await abrir();
    const input = renderer?.root.findByProps({ id: "f-alergia" });
    await act(async () => {
      input?.props.onChange({ target: { value: "Rascunho do animal A" } });
    });
    expect(renderer?.root.findByProps({ id: "f-alergia" }).props.value).toBe(
      "Rascunho do animal A",
    );
    await trocar("pet-b");
    expect(renderer?.root.findByProps({ id: "f-alergia" }).props.value).toBe("Alergia salva pet-b");
  });
});
