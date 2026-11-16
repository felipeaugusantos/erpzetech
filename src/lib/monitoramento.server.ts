// Gravação dos erros no banco (só servidor). Nunca derruba quem chamou: qualquer falha aqui é engolida, e este arquivo NÃO usa
// console.error (o monitor do servidor escuta console.error e entraria em laço).
import { ehRuido, impressaoDoErro, montarRelato, type Relato } from "./monitoramento";

type Banco = {
  rpc(
    nome: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ error: { message: string } | null }>;
  auth: {
    getUser(token: string): Promise<{ data: { user: { id: string } | null } }>;
  };
  from(tabela: string): {
    select(colunas: string): {
      eq(
        coluna: string,
        valor: string,
      ): { maybeSingle(): PromiseLike<{ data: { tenant_id: string | null } | null }> };
    };
  };
};

async function banco(): Promise<Banco> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Banco;
}

/** Empresa de quem estava logado, a partir do token que o navegador mandou. Falha = sem empresa (o erro é registrado igual). */
export async function empresaDoToken(token: string | null): Promise<string | null> {
  if (!token) return null;
  try {
    const db = await banco();
    const { data } = await db.auth.getUser(token);
    if (!data.user) return null;
    const { data: perfil } = await db
      .from("profiles")
      .select("tenant_id")
      .eq("id", data.user.id)
      .maybeSingle();
    return perfil?.tenant_id ?? null;
  } catch {
    return null;
  }
}

export async function gravarRelato(relato: Relato, tenantId: string | null): Promise<boolean> {
  try {
    const db = await banco();
    const impressao = await impressaoDoErro(relato);
    const { error } = await db.rpc("erro_app_registrar", {
      p_impressao: impressao,
      p_origem: relato.origem,
      p_mensagem: relato.mensagem,
      p_stack: relato.stack,
      p_rota: relato.rota,
      p_navegador: relato.navegador,
      p_tenant: tenantId,
    });
    return !error;
  } catch {
    return false;
  }
}

const jaVistos = new WeakSet<object>();
let gravando = 0;

/** Chamado pelo monitor do servidor para cada Error registrado em console.error. */
export function relatarErroDoServidor(error: unknown): void {
  if (!(error instanceof Error) || jaVistos.has(error)) return;
  jaVistos.add(error);
  // erros com status 4xx (não autorizado, não encontrado, validação) são resposta normal, não defeito
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const codigo =
    typeof status === "number" ? status : typeof statusCode === "number" ? statusCode : null;
  if (codigo !== null && codigo >= 400 && codigo < 500) return;
  if (gravando >= 5) return;
  const relato = montarRelato(error, { origem: "servidor" });
  if (ehRuido(relato.mensagem, relato.stack)) return;
  gravando++;
  void gravarRelato(relato, null).finally(() => {
    gravando--;
  });
}
