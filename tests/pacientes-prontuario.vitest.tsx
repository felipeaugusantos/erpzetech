import React from "react";
import { act, create } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn(async () => ({ data: { total: 1, pacientes: [{ id: "leo", nome: "Léo", especie: "gato", raca: null, tutor: "Bruna", atendimentos: 2, ultimo_atendimento: "2026-11-12T12:00:00Z", em_atendimento: true }] }, error: null })));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useSessionData", () => ({ useSessionData: () => ({ data: { user: { id: "vet" }, profile: { tenant_id: "clinica" } } }) }));
import { PacientesProntuario } from "../src/components/app/PacientesProntuario";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("carrega pacientes atendidos sem busca e abre o prontuário do paciente escolhido", async () => {
  const abrir = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tela: ReturnType<typeof create> | undefined;
  await act(async () => { tela = create(<QueryClientProvider client={qc}><PacientesProntuario aoAbrir={abrir} /></QueryClientProvider>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(rpc).toHaveBeenCalledWith("clinica_pacientes_atendidos", { p_pagina: 0 });
  const botao = tela?.root.findAllByType("button").find(b => b.props.className.includes("w-full"));
  expect(botao).toBeDefined();
  await act(async () => { botao?.props.onClick(); });
  expect(abrir).toHaveBeenCalledWith("leo");
  await act(async () => { tela?.unmount(); });
  qc.clear();
});