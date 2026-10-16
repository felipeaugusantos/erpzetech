// NFC-e no balcão: CPF do consumidor e o resumo da nota para o operador do caixa.

export const soDigitos = (v: string) => v.replace(/\D/g, "");

/** CPF com os dois dígitos verificadores corretos (e que não seja uma sequência repetida). */
export function cpfValido(valor: string): boolean {
  const c = soDigitos(valor);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(c[i]) * (tamanho + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(c[tamanho])) return false;
  }
  return true;
}

export function formatarCpf(valor: string): string {
  const c = soDigitos(valor).slice(0, 11);
  return c
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

/** Texto de erro do CPF digitado, ou nulo (vazio é válido: consumidor não identificado). */
export function erroCpf(valor: string): string | null {
  const c = soDigitos(valor);
  if (c === "") return null;
  return cpfValido(c) ? null : "CPF inválido. Confira os números ou deixe em branco.";
}

export type NotaBalcao = {
  situacao: string;
  numero: number | null;
  serie: number | null;
  pendencias: string[] | null;
  mensagem: string | null;
  contingencia: boolean;
};

export type ResumoNfce = {
  titulo: string;
  tom: "ok" | "aviso" | "erro";
  detalhes: string[];
};

/** O que o operador vê sobre a NFC-e da venda. A transmissão ainda não existe: "pronta" quer dizer só isso. */
export function resumirNfce(n: NotaBalcao): ResumoNfce {
  const ident = n.numero != null ? ` nº ${n.numero} · série ${n.serie ?? 1}` : "";
  switch (n.situacao) {
    case "autorizada":
      return { titulo: `NFC-e${ident} autorizada`, tom: "ok", detalhes: [] };
    case "pronta":
      return {
        titulo: `NFC-e${ident} pronta para transmitir`,
        tom: "aviso",
        detalhes: [
          n.contingencia
            ? "A contingência está ligada: a nota será enviada quando a Sefaz voltar."
            : "A transmissão à Sefaz ainda não está ativa; a nota fica guardada e aparece nas pendências fiscais.",
        ],
      };
    case "transmitida":
      return { titulo: `NFC-e${ident} enviada, aguardando a Sefaz`, tom: "aviso", detalhes: [] };
    case "contingencia":
      return {
        titulo: `NFC-e${ident} em contingência`,
        tom: "aviso",
        detalhes: ["Será enviada quando a Sefaz voltar."],
      };
    case "rejeitada":
      return {
        titulo: `NFC-e${ident} rejeitada`,
        tom: "erro",
        detalhes: n.mensagem ? [n.mensagem] : [],
      };
    case "cancelada":
      return { titulo: `NFC-e${ident} cancelada`, tom: "erro", detalhes: [] };
    default:
      return {
        titulo: "NFC-e em rascunho: falta resolver pendências",
        tom: "erro",
        detalhes: n.pendencias ?? [],
      };
  }
}
