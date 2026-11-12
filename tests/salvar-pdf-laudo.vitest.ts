import { expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc, storage: { from: () => ({ upload: mocks.upload }) } } }));
import { salvarPdfLaudo, type ReservaPdfLaudo } from "../src/lib/salvar-pdf-laudo";
beforeEach(() => vi.resetAllMocks());
it("salva o PDF original do exame e não repete arquivo confirmado", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { id: "anexo", caminho: "privado.pdf" }, error: null }).mockResolvedValue({ error: null });
  mocks.upload.mockResolvedValue({ error: null });
  const reservas = new Map<string, ReservaPdfLaudo>();
  const arquivo = { name: "laudo.pdf", size: 100 } as File;
  await salvarPdfLaudo("exame", arquivo, reservas);
  await salvarPdfLaudo("exame", arquivo, reservas);
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith("clinica_anexo_preparar", { p_dados: { exame_id: "exame", categoria: "laudo", descricao: "PDF original do laudo importado", nome_arquivo: "laudo.pdf", mime: "application/pdf", tamanho: 100 } });
  expect(reservas.get("exame")?.confirmado).toBe(true);
});
it("reenvio após falha na confirmação preserva a reserva e não envia de novo", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { id: "anexo", caminho: "privado.pdf" }, error: null }).mockResolvedValueOnce({ error: new Error("conexão") }).mockResolvedValue({ error: null });
  mocks.upload.mockResolvedValue({ error: null });
  const reservas = new Map<string, ReservaPdfLaudo>();
  const arquivo = { name: "laudo.pdf", size: 100 } as File;
  await expect(salvarPdfLaudo("exame", arquivo, reservas)).rejects.toThrow("conexão");
  await salvarPdfLaudo("exame", arquivo, reservas);
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(reservas.get("exame")?.confirmado).toBe(true);
});