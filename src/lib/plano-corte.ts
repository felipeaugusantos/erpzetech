// Plano de corte de chapas (MDF, compensado): distribui as peças em chapas por faixas (cortes de ponta a ponta, como numa seccionadora),
// conta as chapas e o aproveitamento. Só conta e desenho: não grava nada. Medidas em milímetros.

export type PecaCorte = {
  nome: string;
  largura: number;
  altura: number;
  quantidade: number;
  /** falso quando o veio da madeira precisa seguir a direção da chapa */
  girar: boolean;
};

export type ChapaCorte = {
  largura: number;
  altura: number;
  /** margem refilada em volta da chapa */
  refilo: number;
  /** espessura do corte da serra */
  serra: number;
};

export type PecaPosicionada = {
  nome: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
  girada: boolean;
};
export type ChapaUsada = { pecas: PecaPosicionada[] };
export type PlanoCorte = {
  chapas: ChapaUsada[];
  naoCabem: string[];
  areaPecas: number;
  aproveitamento: number;
};

type Unidade = { nome: string; w: number; h: number; girar: boolean };
type Faixa = { y: number; altura: number; usado: number };
type ChapaAberta = { faixas: Faixa[]; pecas: PecaPosicionada[]; yLivre: number };

const arredonda = (n: number, casas: number) => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Erro de uma peça ou chapa (texto vazio se estiver certa). */
export function erroDaChapa(c: ChapaCorte): string {
  // texto que não é número chega como NaN e passaria em todas as comparações abaixo
  if (![c.largura, c.altura, c.refilo, c.serra].every(Number.isFinite))
    return "Use só números nas medidas da chapa.";
  if (!(c.largura > 0) || !(c.altura > 0)) return "Informe a largura e a altura da chapa.";
  if (c.refilo < 0 || c.serra < 0) return "O refilo e a serra não podem ser negativos.";
  if (c.largura - 2 * c.refilo <= 0 || c.altura - 2 * c.refilo <= 0)
    return "O refilo é maior que a chapa.";
  return "";
}

/** Distribui as peças pelas chapas. Tenta duas formas de orientar as peças e fica com a que usa menos chapas (e menos desperdício). */
export function planoDeCorte(pecas: PecaCorte[], chapa: ChapaCorte): PlanoCorte {
  const validas = pecas.filter((p) => p.largura > 0 && p.altura > 0 && p.quantidade > 0);
  const unidades: Unidade[] = [];
  for (const p of validas)
    for (let i = 0; i < Math.floor(p.quantidade); i++)
      unidades.push({ nome: p.nome, w: p.largura, h: p.altura, girar: p.girar });

  const util = { w: chapa.largura - 2 * chapa.refilo, h: chapa.altura - 2 * chapa.refilo };
  const candidatos = [
    empacota(unidades, util, chapa, "alta"),
    empacota(unidades, util, chapa, "baixa"),
  ];
  const melhor = candidatos.reduce((a, b) =>
    b.chapas.length < a.chapas.length
      ? b
      : b.chapas.length === a.chapas.length && b.ultimaCheia < a.ultimaCheia
        ? b
        : a,
  );

  const areaPecas = melhor.chapas.reduce(
    (s, c) => s + c.pecas.reduce((t, p) => t + p.largura * p.altura, 0),
    0,
  );
  const areaChapas = melhor.chapas.length * chapa.largura * chapa.altura;
  return {
    chapas: melhor.chapas.map((c) => ({ pecas: c.pecas })),
    naoCabem: melhor.naoCabem,
    areaPecas,
    aproveitamento: areaChapas > 0 ? arredonda((areaPecas / areaChapas) * 100, 1) : 0,
  };
}

function empacota(
  unidades: Unidade[],
  util: { w: number; h: number },
  chapa: ChapaCorte,
  modo: "alta" | "baixa",
): { chapas: ChapaAberta[]; naoCabem: string[]; ultimaCheia: number } {
  const naoCabem: string[] = [];
  // a faixa corre ao longo da largura da chapa; cada peça é orientada para a faixa (lado maior na altura em "alta", menor em "baixa")
  const orientadas: Array<{ nome: string; w: number; h: number; girada: boolean }> = [];
  for (const u of unidades) {
    let w = u.w;
    let h = u.h;
    let girada = false;
    if (u.girar && ((modo === "alta" && w > h) || (modo === "baixa" && h > w))) {
      [w, h] = [h, w];
      girada = true;
    }
    if (w > util.w || h > util.h) {
      if (u.girar && h <= util.w && w <= util.h) {
        [w, h] = [h, w];
        girada = !girada;
      } else {
        naoCabem.push(u.nome);
        continue;
      }
    }
    orientadas.push({ nome: u.nome, w, h, girada });
  }
  orientadas.sort((a, b) => b.h - a.h || b.w - a.w);

  // o corte consome a espessura da serra: a peça ocupa largura + serra e a faixa altura + serra, e a chapa útil ganha uma serra a mais na borda
  const W = util.w + chapa.serra;
  const H = util.h + chapa.serra;
  const chapas: ChapaAberta[] = [];
  for (const p of orientadas) {
    const pw = p.w + chapa.serra;
    const ph = p.h + chapa.serra;
    let colocada = false;
    for (const c of chapas) {
      const faixa = c.faixas.find((f) => f.altura >= ph && f.usado + pw <= W);
      if (faixa) {
        c.pecas.push({
          nome: p.nome,
          x: chapa.refilo + faixa.usado,
          y: chapa.refilo + faixa.y,
          largura: p.w,
          altura: p.h,
          girada: p.girada,
        });
        faixa.usado += pw;
        colocada = true;
        break;
      }
      if (c.yLivre + ph <= H) {
        const faixa = { y: c.yLivre, altura: ph, usado: pw };
        c.faixas.push(faixa);
        c.yLivre += ph;
        c.pecas.push({
          nome: p.nome,
          x: chapa.refilo,
          y: chapa.refilo + faixa.y,
          largura: p.w,
          altura: p.h,
          girada: p.girada,
        });
        colocada = true;
        break;
      }
    }
    if (!colocada) {
      const faixa = { y: 0, altura: ph, usado: pw };
      chapas.push({
        faixas: [faixa],
        yLivre: ph,
        pecas: [
          {
            nome: p.nome,
            x: chapa.refilo,
            y: chapa.refilo,
            largura: p.w,
            altura: p.h,
            girada: p.girada,
          },
        ],
      });
    }
  }
  const ultima = chapas[chapas.length - 1];
  const ultimaCheia = ultima ? ultima.pecas.reduce((s, p) => s + p.largura * p.altura, 0) : 0;
  return { chapas, naoCabem, ultimaCheia };
}

/** Perda % para a lista de materiais: o que sobra das chapas em relação ao total delas. */
export const perdaDoPlano = (aproveitamento: number): number =>
  arredonda(Math.max(100 - aproveitamento, 0), 1);
