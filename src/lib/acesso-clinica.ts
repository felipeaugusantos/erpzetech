// Quem pode abrir o trabalho sem internet da clínica quando o aparelho está sem sinal. A sessão e o cadastro da empresa vêm da rede e o cache
// do navegador vence em 24 horas, mas a cópia da visita vale 7 dias: por isso o que a tela precisa saber (clínica liberada e perfil
// Veterinário) é guardado à parte, só com esses dois sins e nãos (nada sensível), com a mesma validade. O cofre continua exigindo a senha.

export const VALIDADE_ACESSO_DIAS = 7;
const CHAVE = "zt-clinica-acesso";

export type MiniArmazem = {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
};

export type AcessoLocal = { clinica: boolean; veterinario: boolean };

function padrao(): MiniArmazem | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function salvarAcessoLocal(
  userId: string,
  acesso: AcessoLocal,
  agora: Date = new Date(),
  armazem: MiniArmazem | null = padrao(),
): void {
  try {
    armazem?.setItem(
      CHAVE,
      JSON.stringify({
        userId,
        ...acesso,
        validoAte: new Date(agora.getTime() + VALIDADE_ACESSO_DIAS * 86_400_000).toISOString(),
      }),
    );
  } catch {
    /* sem espaço: segue sem a cópia */
  }
}

/** Os sins e nãos guardados para este usuário, se ainda valem. */
export function lerAcessoLocal(
  userId: string,
  agora: Date = new Date(),
  armazem: MiniArmazem | null = padrao(),
): AcessoLocal | null {
  try {
    const texto = armazem?.getItem(CHAVE);
    if (!texto) return null;
    const a = JSON.parse(texto) as {
      userId?: string;
      clinica?: boolean;
      veterinario?: boolean;
      validoAte?: string;
    };
    if (a.userId !== userId || typeof a.validoAte !== "string") return null;
    if (new Date(a.validoAte).getTime() <= agora.getTime()) return null;
    return { clinica: a.clinica === true, veterinario: a.veterinario === true };
  } catch {
    return null;
  }
}

export function limparAcessoLocal(armazem: MiniArmazem | null = padrao()): void {
  try {
    armazem?.removeItem(CHAVE);
  } catch {
    /* nada a fazer */
  }
}

export type DecisaoAcesso =
  "carregando" | "liberado" | "sem_clinica" | "sem_perfil" | "sem_confirmacao";

/**
 * Com a sessão conhecida (da rede ou do cache de 24 horas), ela decide. Sem ela (sem sinal e cache vencido), vale o que foi guardado
 * para este usuário; sem isso, a pessoa precisa entrar com internet ao menos uma vez.
 */
export function decidirAcesso(e: {
  carregando: boolean;
  sessaoConfirmada: boolean;
  clinica: boolean;
  veterinario: boolean;
  local: AcessoLocal | null;
}): DecisaoAcesso {
  if (e.sessaoConfirmada) {
    if (!e.clinica) return "sem_clinica";
    if (!e.veterinario) return "sem_perfil";
    return "liberado";
  }
  if (e.carregando) return "carregando";
  return e.local?.clinica && e.local.veterinario ? "liberado" : "sem_confirmacao";
}
