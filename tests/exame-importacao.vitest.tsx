import React, { useState } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ExameClinico } from "../src/lib/exames";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => <section data-open={open}>{open && children}</section>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));
import { ImportarLaudoPdf } from "../src/components/app/ImportarLaudoPdf";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("consome a solicitação uma vez e não reabre ao montar outro exame", async () => {
  const consumir = vi.fn();
  const qc = new QueryClient();
  function Tela({ id }: { id: string }) {
    const [pedido, setPedido] = useState(1);
    const exame = { id, nome: "Bioquímica", pet: { nome: "Léo", especie: "gato" } } as ExameClinico;
    return <QueryClientProvider client={qc}><ImportarLaudoPdf key={id} exame={exame} disabled={false} solicitacao={pedido} onConsumir={() => { consumir(); setPedido(0); }} onAplicar={() => {}} /></QueryClientProvider>;
  }
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => { renderer = create(<Tela id="a" />); });
  expect(consumir).toHaveBeenCalledTimes(1);
  expect(renderer?.root.findAllByProps({ "data-open": true })).toHaveLength(1);
  await act(async () => { renderer?.update(<Tela id="b" />); });
  expect(consumir).toHaveBeenCalledTimes(1);
  expect(renderer?.root.findAllByProps({ "data-open": true })).toHaveLength(0);
  await act(async () => { renderer?.unmount(); });
});