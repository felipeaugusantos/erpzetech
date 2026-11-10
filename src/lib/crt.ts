// Código de Regime Tributário (CRT) do emitente e o grupo de ICMS que ele permite na NF-e.
// CRT 1 (Simples Nacional) e CRT 4 (MEI) informam o ICMS por CSOSN (3 dígitos); CRT 2 (Simples com excesso de
// sublimite) e CRT 3 (regime normal) informam por CST (2 dígitos). Misturar é rejeição da Sefaz.

import type { CrtEmitente } from "./ibs-cbs.ts";

/** O ICMS do item precisa combinar com o CRT; devolve o erro com o produto, ou null se estiver coerente. */
export function erroIcmsCrt(crt: CrtEmitente, cstCsosn: unknown, descricao: string): string | null {
  const codigo = String(cstCsosn ?? "").replace(/\D/g, "");
  const simplesCsosn = crt === 1 || crt === 4;
  if (simplesCsosn) {
    // vazio cai no padrão seguro do Simples (CSOSN 102); CST de 2 dígitos não combina com o CRT
    if (codigo.length === 2) {
      return `O produto ${descricao} usa CST de ICMS (${codigo}), mas o regime da empresa (Simples Nacional ou MEI) exige CSOSN de 3 dígitos. Corrija no produto.`;
    }
    return null;
  }
  if (codigo.length === 0) {
    return `O produto ${descricao} está sem CST de ICMS, que o regime da empresa exige. Informe no produto.`;
  }
  if (codigo.length === 3) {
    return `O produto ${descricao} usa CSOSN (${codigo}), mas o regime da empresa (normal ou Simples com excesso de sublimite) exige CST de 2 dígitos. Corrija no produto.`;
  }
  return null;
}
