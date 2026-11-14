import { expect, it } from "vitest";
import { aplicarTranscricao, lerTranscricao } from "../src/lib/consulta-audio";
import { encodeWav } from "../src/lib/record-wav";
import type { FormAtendimento } from "../src/lib/clinica";

const form = { anamnese: "Texto existente", diagnostico: "Preservado" } as FormAtendimento;
it("só acrescenta o texto ao campo confirmado sem alterar o rascunho original", () => {
  const novo = aplicarTranscricao(form, "anamnese", "Temperatura 38,5.");
  expect(novo.anamnese).toBe("Texto existente\n\nTemperatura 38,5.");
  expect(form.anamnese).toBe("Texto existente");
  expect(novo.diagnostico).toBe("Preservado");
});
it("recusa texto vazio", () => expect(() => aplicarTranscricao(form, "anamnese", "  ")).toThrow());
it("respeita o limite de texto do atendimento", () => expect(() => aplicarTranscricao(form, "anamnese", "a".repeat(8000))).toThrow());
it("consome streaming dividido e usa o texto final preciso", async () => {
  const encoder = new TextEncoder();
  const s = 'data: {"type":"transcript.text.delta","delta":"Temperatura "}\n\ndata: {"type":"transcript.text.done","text":"Temperatura 38,5."}\n\n';
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(encoder.encode(s.slice(0, 34))); c.enqueue(encoder.encode(s.slice(34))); c.close(); } }));
  expect(await lerTranscricao(response, () => {})).toBe("Temperatura 38,5.");
});
it("recusa streaming incompleto sem habilitar salvamento", async () => {
  await expect(lerTranscricao(new Response('data: {"type":"transcript.text.delta","delta":"Parcial"}\n\n'), () => {})).rejects.toThrow("incompleta");
});
it("preserva a mensagem de bloqueio do serviço", async () => {
  await expect(lerTranscricao(Response.json({ message: "Créditos insuficientes" }, { status: 402 }), () => {})).rejects.toThrow("Créditos insuficientes");
});
it("gera WAV completo e decodificável", async () => {
  const wav = encodeWav([new Float32Array([0, 0.5, -0.5])], 48000);
  const bytes = await wav.arrayBuffer();
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
  expect(new DataView(bytes).getUint32(40, true)).toBe(6);
});