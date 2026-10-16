// Configuração da NFC-e: validação do que o usuário digita (as mesmas regras do banco).

export type FormNfce = { serie: string; cscId: string; cscToken: string };

const SO_NUMEROS = /^[0-9]+$/;
const LETRAS_E_NUMEROS = /^[A-Za-z0-9]+$/;

/** Devolve a mensagem do primeiro problema, ou nulo quando está tudo certo. `tokenJaGuardado` deixa o token em branco. */
export function validarConfigNfce(f: FormNfce, tokenJaGuardado: boolean): string | null {
  const serie = f.serie.trim();
  if (!SO_NUMEROS.test(serie) || Number(serie) > 999)
    return "A série deve ser um número de 0 a 999.";

  const id = f.cscId.trim();
  const token = f.cscToken.trim();
  if (id === "" && (token !== "" || tokenJaGuardado)) return "Informe o código do CSC.";
  if (id !== "" && (!SO_NUMEROS.test(id) || id.length > 6))
    return "O código do CSC tem de 1 a 6 números.";

  if (token !== "" && (!LETRAS_E_NUMEROS.test(token) || token.length < 16 || token.length > 40)) {
    return "O token do CSC tem de 16 a 40 letras e números, sem espaços nem símbolos.";
  }
  if (id !== "" && token === "" && !tokenJaGuardado) return "Informe o token do CSC.";
  return null;
}

/** Texto curto do que falta para a NFC-e poder ser emitida com esta configuração. */
export function faltaParaEmitir(c: {
  csc_configurado: boolean;
  certificado_nome: string | null;
  emissor: string | null;
}): string[] {
  const falta: string[] = [];
  if (!c.csc_configurado) falta.push("CSC (código e token)");
  if (!c.certificado_nome) falta.push("certificado digital A1");
  if (!c.emissor) falta.push("emissor fiscal");
  return falta;
}
