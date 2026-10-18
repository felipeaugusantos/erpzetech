/** Dígito verificador EAN-13 para os 12 primeiros dígitos. */
export function digitoEan13(doze: string): number {
  const soma = [...doze].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10;
}

/** EAN-13 genérico de uso interno (prefixo 2 = circulação restrita na loja) a partir do código interno. */
export function eanInterno(codigoInterno: string): string {
  const d = codigoInterno.replace(/\D/g, "");
  if (!d) throw new Error("O código interno precisa ter números para gerar o código de barras.");
  if (d.length > 11) throw new Error("Código interno longo demais para o código de barras.");
  const doze = "2" + d.padStart(11, "0");
  return doze + digitoEan13(doze);
}
