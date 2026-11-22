import React from "react";
import { act, create } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => ({ data: [], error: null })) },
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/ui/select", () => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Select: Wrapper,
    SelectTrigger: Wrapper,
    SelectValue: Wrapper,
    SelectContent: Wrapper,
    SelectItem: Wrapper,
  };
});
import { ExamesAgendadosPaciente } from "../src/components/app/ExamesAgendadosPaciente";
import { DocumentosClinicos } from "../src/components/app/DocumentosClinicos";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

for (const secao of ["documentos", "exames"] as const) {
  it(`${secao} começa recolhido e permite expandir e recolher`, async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let tela: ReturnType<typeof create> | undefined;
    await act(async () => {
      tela = create(
        <QueryClientProvider client={qc}>
          {secao === "documentos" ? (
            <DocumentosClinicos
              petId="paciente"
              pet={{ nome: "Paciente", especie: "cao", raca: null }}
              tutor="Tutor"
            />
          ) : (
            <ExamesAgendadosPaciente petId="paciente" />
          )}
        </QueryClientProvider>,
      );
    });
    if (!tela) throw new Error("Seção não montada");
    const controle = () =>
      tela.root.findAllByType("button").find((b) => b.props["aria-expanded"] !== undefined);
    expect(controle()?.props["aria-expanded"]).toBe(false);
    await act(async () => controle()?.props.onClick());
    expect(controle()?.props["aria-expanded"]).toBe(true);
    await act(async () => controle()?.props.onClick());
    expect(controle()?.props["aria-expanded"]).toBe(false);
    await act(async () => tela.unmount());
    qc.clear();
  });
}
