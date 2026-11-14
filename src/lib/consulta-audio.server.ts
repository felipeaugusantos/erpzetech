import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { transcribe } from "./transcribe.server";
import type { Database } from "@/integrations/supabase/types";

const MAX_BODY = 24 * 1024 * 1024;
const ids = z.object({
  atendimento: z.guid(),
  agendamento: z.guid(),
  consentimento: z.literal("true"),
});
export async function transcreverConsulta(request: Request) {
  const falha = (message: string, status: number) =>
    Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return falha("Entre na sua conta para transcrever.", 401);
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const aiKey = process.env["LOVABLE_API_KEY"];
  if (!url || !key || !aiKey) return falha("A transcrição ainda não está configurada.", 503);
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: auth },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
  const user = await client.auth.getUser(auth.slice(7));
  if (user.error || !user.data.user) return falha("Sua sessão expirou.", 401);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    return falha("Envie um áudio válido.", 400);
  if (Number(request.headers.get("content-length")) > MAX_BODY)
    return falha("O áudio ultrapassa o limite de envio.", 413);
  try {
    // Bound actual streamed bytes before multipart parsing, including chunked uploads.
    const reader = request.body?.getReader();
    if (!reader) return falha("Áudio não recebido.", 400);
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > MAX_BODY) {
          await reader.cancel();
          return falha("O áudio ultrapassa o limite de envio.", 413);
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const form = await new Response(bytes, {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
    const parsed = ids.safeParse(
      Object.fromEntries(
        ["atendimento", "agendamento", "consentimento"].map((k) => [k, form.get(k)]),
      ),
    );
    if (!parsed.success)
      return falha("Confirme a autorização da gravação e escolha a consulta.", 400);
    // Existing RPC verifies clinic, tenant, active CRMV and the responsible veterinarian.
    const acesso = await client.rpc("clinica_atendimento_abrir", {
      p_agendamento_id: parsed.data.agendamento,
    });
    if (acesso.error) return falha("Consulta não disponível para este veterinário.", 403);
    const consulta = acesso.data as unknown as { id: string; situacao: string };
    if (consulta.id !== parsed.data.atendimento || consulta.situacao !== "aberto")
      return falha("A consulta não está aberta.", 403);
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size < 2048 ||
      file.size > MAX_BODY - 65536 ||
      file.type !== "audio/wav"
    )
      return falha("Grave um áudio válido em WAV.", 400);
    const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (
      new TextDecoder().decode(signature.slice(0, 4)) !== "RIFF" ||
      new TextDecoder().decode(signature.slice(8)) !== "WAVE"
    )
      return falha("Arquivo de áudio inválido.", 400);
    const result = await transcribe(
      {
        baseURL: "https://ai.gateway.lovable.dev",
        apiKey: aiKey,
        model: "openai/gpt-transcribe",
        maxFileBytes: MAX_BODY - 65536,
        audioOnly: true,
      },
      file,
      { signal: request.signal },
    );
    const headers = new Headers({
      "Content-Type": result.headers.get("Content-Type") ?? "text/event-stream",
      "Cache-Control": "no-store, no-transform",
    });
    result.headers.forEach((v, k) => {
      if (k.toLowerCase().startsWith("x-lovable-aig-")) headers.set(k, v);
    });
    return new Response(result.body, { status: result.status, headers });
  } catch (error) {
    if (request.signal.aborted) return falha("Transcrição cancelada.", 499);
    return falha(
      "Não foi possível processar o áudio. A gravação permanece disponível no celular.",
      500,
    );
  }
}
