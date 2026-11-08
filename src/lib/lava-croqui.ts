import { locaisDeAvaria } from "./lava-rapido.ts";

/** Partes desenhadas no croqui, por tipo de veículo (carro, caminhonete e moto; aeronaves ainda não). */
export function zonasDoCroqui(tipo: string): string[] {
  switch (tipo) {
    case "carro":
      return [
        "Frente",
        "Capô",
        "Para-brisa",
        "Teto",
        "Porta-malas",
        "Traseira",
        "Lateral esquerda",
        "Lateral direita",
        "Rodas",
      ];
    case "caminhonete":
      return [
        "Frente",
        "Capô",
        "Para-brisa",
        "Teto",
        "Caçamba",
        "Traseira",
        "Lateral esquerda",
        "Lateral direita",
        "Rodas",
      ];
    case "moto":
      return ["Rodas", "Farol", "Carenagem", "Retrovisores", "Tanque", "Banco", "Escapamento"];
    default:
      return [];
  }
}

/** Locais sugeridos que o desenho não cobre (ex.: Interior); viram botões ao lado do croqui. */
export function locaisForaDoCroqui(tipo: string): string[] {
  const desenhados = new Set(zonasDoCroqui(tipo));
  return locaisDeAvaria(tipo).filter((l) => !desenhados.has(l));
}

/** Quantas avarias há em cada local (chave em minúsculas, sem espaços nas pontas). */
export function contagemPorLocal(avarias: { lugar: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of avarias) {
    const k = a.lugar.trim().toLowerCase();
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
