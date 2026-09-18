/** Geração do PIX copia e cola (BR Code estático, padrão Banco Central). */

function crc16(payload: string) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function campo(id: string, valor: string) {
  return `${id}${String(valor.length).padStart(2, "0")}${valor}`;
}

/** Remove acentos e caracteres não aceitos pelo BR Code. */
function limpar(texto: string, max: number) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 .\-]/g, "")
    .trim()
    .slice(0, max)
    .toUpperCase();
}

export type DadosPix = {
  chave: string;
  beneficiario: string;
  cidade: string;
  valor: number;
  /** Identificador da cobrança (aparece no extrato). */
  referencia?: string;
};

export function gerarPixCopiaCola({ chave, beneficiario, cidade, valor, referencia }: DadosPix) {
  const ref = limpar(referencia ?? "COBRANCA", 25).replace(/ /g, "") || "COBRANCA";
  const semCrc =
    campo("00", "01") +
    campo("26", campo("00", "br.gov.bcb.pix") + campo("01", chave.trim())) +
    campo("52", "0000") +
    campo("53", "986") +
    campo("54", valor.toFixed(2)) +
    campo("58", "BR") +
    campo("59", limpar(beneficiario, 25) || "ZE TECH") +
    campo("60", limpar(cidade, 15) || "SAO PAULO") +
    campo("62", campo("05", ref)) +
    "6304";
  return semCrc + crc16(semCrc);
}
