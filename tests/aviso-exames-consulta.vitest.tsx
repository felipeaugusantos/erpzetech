import React from "react";
import { act, create } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn(async (nome: string) => ({ data: nome === "clinica_exames_do_pet" ? { exames: [] } : [], error: null })));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { AvisoExamesConsulta } from "../src/components/app/AvisoExamesConsulta";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("lê somente os anexos da consulta e relê quando o envio invalida sua chave", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tela: ReturnType<typeof create> | undefined;
  await act(async () => {
    tela = create(
      <QueryClientProvider client={qc}>
        <AvisoExamesConsulta atendimentoId="consulta-18" petId="pet" dia="2026-11-18" consultasNoDia={1} />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(rpc).toHaveBeenCalledWith("clinica_anexos", {
    p_atendimento_id: "consulta-18",
  });
  await act(async () => {
    await qc.invalidateQueries({ queryKey: ["clinica-anexos", "consulta-18"] });
  });
  expect(rpc).toHaveBeenCalledTimes(3);
  await act(async () => tela?.unmount());
  qc.clear();
});
