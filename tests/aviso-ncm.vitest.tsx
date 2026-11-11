import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { AvisoNcm } from "../src/components/app/AvisoNcm";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let renderer: ReactTestRenderer | undefined;
let qc: QueryClient;
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
};
const tree = (ncm: string) => (
  <QueryClientProvider client={qc}>
    <AvisoNcm ncm={ncm} />
  </QueryClientProvider>
);
async function mostrar(ncm: string) {
  qc ??= new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    if (renderer) renderer.update(tree(ncm));
    else renderer = create(tree(ncm));
  });
  await flush();
  return JSON.stringify(renderer?.toJSON());
}
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
  qc?.clear();
});

describe("Aviso de NCM fora da Tabela NCM", () => {
  it("não avisa sem NCM, com NCM incompleto ou com NCM que existe", async () => {
    expect(await mostrar("")).toBe("null");
    expect(await mostrar("2309")).toBe("null");
    expect(await mostrar("2309.10.00")).toBe("null");
  });

  it("avisa quando o NCM tem 8 dígitos e não existe, com a data da tabela", async () => {
    const t = await mostrar("23091001");
    expect(t).toContain("não consta na Tabela NCM vigente");
    expect(t).toContain("ainda pode salvar");
    expect(t).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it("some o aviso quando o NCM é corrigido", async () => {
    expect(await mostrar("99999999")).toContain("não consta");
    expect(await mostrar("23091000")).toBe("null");
  });
});
