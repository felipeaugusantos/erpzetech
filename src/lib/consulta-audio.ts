import { createParser } from "eventsource-parser";
import type { FormAtendimento } from "./clinica";

export const CAMPOS_AUDIO = {
  queixa: "Queixa", anamnese: "Anamnese", exame_fisico: "Exame físico",
  diagnostico: "Diagnóstico", conduta: "Conduta", observacoes: "Observações",
} as const;
export type CampoAudio = keyof typeof CAMPOS_AUDIO;
export function aplicarTranscricao(form: FormAtendimento, campo: CampoAudio, texto: string): FormAtendimento {
  const trecho = texto.trim();
  if (!trecho) throw new Error("A transcrição está vazia.");
  const novo = [form[campo].trim(), trecho].filter(Boolean).join("\n\n");
  if (novo.length > 8000) throw new Error("O campo aceita até 8000 caracteres; revise o texto.");
  return { ...form, [campo]: novo };
}

export async function lerTranscricao(response: Response, onTexto: (texto: string) => void) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? body.error?.message ?? "Não foi possível transcrever o áudio.");
  }
  if (!response.body) throw new Error("A transcrição não foi recebida.");
  let texto = "";
  let completo = false;
  let erro: string | undefined;
  const parser = createParser({ onEvent(event) {
    if (event.data === "[DONE]") return;
    const dado = JSON.parse(event.data);
    if (dado.type === "transcript.text.delta") { texto += dado.delta; onTexto(texto); }
    if (dado.type === "transcript.text.done") { texto = dado.text; completo = true; onTexto(texto); }
    if (dado.error || dado.type === "error") erro = dado.error?.message ?? dado.message ?? "Transcrição interrompida.";
  } });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      parser.feed(decoder.decode(chunk.value, { stream: true }));
    }
    parser.feed(decoder.decode());
  } finally { reader.releaseLock(); }
  if (erro) throw new Error(erro);
  if (!completo) throw new Error("Transcrição incompleta. O áudio continua disponível para nova tentativa.");
  if (!texto.trim()) throw new Error("Não foi identificada fala no áudio.");
  return texto;
}