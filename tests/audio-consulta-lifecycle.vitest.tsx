import React from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
const stop = vi.fn(async () => new File([new Uint8Array(3000)], "audio.wav", { type: "audio/wav" }));
vi.mock("@/lib/record-wav", () => ({ recordWav: vi.fn(async () => ({ stop })) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn() } } }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <section>{children}</section> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
vi.mock("@/components/ui/checkbox", () => ({ Checkbox: (props: { onCheckedChange: (v: boolean) => void }) => <input type="checkbox" onChange={() => props.onCheckedChange(true)} /> }));
import { AudioConsulta } from "../src/components/app/AudioConsulta";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("não salva ao gravar e encerra o microfone ao trocar a consulta", async () => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: vi.fn() } } });
  Object.assign(globalThis, { window: globalThis });
  const salvar = vi.fn();
  let r: ReturnType<typeof create> | undefined;
  await act(async () => { r = create(<AudioConsulta key="a" atendimento="a" agendamento="a" onConfirmar={salvar} />); });
  await act(async () => { r?.root.findByType("button").props.onClick(); });
  await act(async () => { r?.root.findByType("input").props.onChange(); });
  const iniciar = r?.root.findAllByType("button").find(b => b.children.includes("Iniciar gravação"));
  await act(async () => { iniciar?.props.onClick(); });
  expect(salvar).not.toHaveBeenCalled();
  await act(async () => { r?.update(<AudioConsulta key="b" atendimento="b" agendamento="b" onConfirmar={salvar} />); });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(salvar).not.toHaveBeenCalled();
  await act(async () => { r?.unmount(); });
});