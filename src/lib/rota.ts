/** Roteirização automática por urgência, proximidade (bairro/cidade) e capacidade do veículo. */

export type ItemPendente = {
  pedido_item_id: string;
  quantidade: number;
  peso: number;
  volume: number;
};

export type PedidoRota = {
  id: string;
  numero: number;
  cliente: string;
  bairro: string;
  cidade: string;
  previsao: string | null;
  itens: ItemPendente[];
  pesoKg: number;
  volumeM3: number;
};

export type VeiculoRota = {
  id: string;
  placa: string;
  descricao: string;
  capacidade_kg: number | null;
  capacidade_m3: number | null;
  motorista_id?: string | null;
  motorista_nome?: string | null;
};

export type ParadaSugerida = { pedido: PedidoRota; sequencia: number };

export type RotaSugerida = {
  veiculo: VeiculoRota;
  paradas: ParadaSugerida[];
  pesoKg: number;
  volumeM3: number;
};

export type Sobra = { pedido: PedidoRota; motivo: string };

export const hojeISO = () => new Date().toISOString().slice(0, 10);

/** Dias até a previsão de entrega. Negativo = atrasado. Sem previsão = baixa urgência. */
export function diasParaEntrega(previsao: string | null, hoje = hojeISO()): number {
  if (!previsao) return 999;
  const a = new Date(`${previsao}T12:00:00`).getTime();
  const b = new Date(`${hoje}T12:00:00`).getTime();
  return Math.round((a - b) / 86_400_000);
}

export function rotuloUrgencia(dias: number) {
  if (dias === 999) return { label: "Sem data", classe: "bg-secondary text-secondary-foreground" };
  if (dias < 0)
    return { label: `Atrasada ${Math.abs(dias)}d`, classe: "bg-destructive/15 text-destructive" };
  if (dias === 0) return { label: "Para hoje", classe: "bg-warning/20 text-warning-foreground" };
  if (dias <= 2) return { label: `Em ${dias}d`, classe: "bg-info/15 text-info" };
  return { label: `Em ${dias}d`, classe: "bg-secondary text-secondary-foreground" };
}

/** Volume em m³ a partir de dimensões em centímetros. */
export function volumeM3(
  altura?: number | null,
  largura?: number | null,
  comprimento?: number | null,
) {
  const a = Number(altura ?? 0);
  const l = Number(largura ?? 0);
  const c = Number(comprimento ?? 0);
  if (a <= 0 || l <= 0 || c <= 0) return 0;
  return (a * l * c) / 1_000_000;
}

const norm = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

/** 0 = mesmo bairro, 1 = mesma cidade, 2 = cidade diferente. */
export function proximidade(a: PedidoRota, b: PedidoRota) {
  if (norm(a.cidade) !== norm(b.cidade)) return 2;
  if (a.bairro && b.bairro && norm(a.bairro) === norm(b.bairro)) return 0;
  return 1;
}

function cabe(veiculo: VeiculoRota, pesoAtual: number, volAtual: number, p: PedidoRota) {
  const capKg = Number(veiculo.capacidade_kg ?? 0);
  const capM3 = Number(veiculo.capacidade_m3 ?? 0);
  if (capKg > 0 && pesoAtual + p.pesoKg > capKg) return false;
  if (capM3 > 0 && volAtual + p.volumeM3 > capM3) return false;
  return true;
}

/**
 * Monta a rota do dia: prioriza o pedido mais urgente, agrupa vizinhos do mesmo
 * bairro/cidade e para quando a capacidade do veículo se esgota.
 */
export function roteirizar(
  pedidos: PedidoRota[],
  veiculos: VeiculoRota[],
  hoje = hojeISO(),
): { rotas: RotaSugerida[]; sobras: Sobra[] } {
  const fila = [...pedidos].sort((a, b) => {
    const da = diasParaEntrega(a.previsao, hoje);
    const db = diasParaEntrega(b.previsao, hoje);
    if (da !== db) return da - db;
    const ca = norm(a.cidade).localeCompare(norm(b.cidade));
    if (ca !== 0) return ca;
    const ba = norm(a.bairro).localeCompare(norm(b.bairro));
    if (ba !== 0) return ba;
    return a.numero - b.numero;
  });

  const ordemVeiculos = [...veiculos].sort(
    (a, b) => Number(b.capacidade_kg ?? 0) - Number(a.capacidade_kg ?? 0),
  );

  const pendentes = new Set(fila.map((p) => p.id));
  const rotas: RotaSugerida[] = [];

  for (const veiculo of ordemVeiculos) {
    const paradas: ParadaSugerida[] = [];
    let peso = 0;
    let vol = 0;

    const ancora = fila.find((p) => pendentes.has(p.id) && cabe(veiculo, peso, vol, p));
    if (!ancora) continue;

    let atual = ancora;
    pendentes.delete(atual.id);
    paradas.push({ pedido: atual, sequencia: 1 });
    peso += atual.pesoKg;
    vol += atual.volumeM3;

    for (;;) {
      const candidatos = fila
        .filter((p) => pendentes.has(p.id) && cabe(veiculo, peso, vol, p))
        .sort((a, b) => {
          const pa = proximidade(atual, a);
          const pb = proximidade(atual, b);
          if (pa !== pb) return pa - pb;
          return diasParaEntrega(a.previsao, hoje) - diasParaEntrega(b.previsao, hoje);
        });
      const proximo = candidatos[0];
      if (!proximo) break;
      pendentes.delete(proximo.id);
      paradas.push({ pedido: proximo, sequencia: paradas.length + 1 });
      peso += proximo.pesoKg;
      vol += proximo.volumeM3;
      atual = proximo;
    }

    rotas.push({ veiculo, paradas, pesoKg: peso, volumeM3: vol });
  }

  const sobras: Sobra[] = fila
    .filter((p) => pendentes.has(p.id))
    .map((p) => {
      const maiorKg = Math.max(0, ...veiculos.map((v) => Number(v.capacidade_kg ?? 0)));
      const maiorM3 = Math.max(0, ...veiculos.map((v) => Number(v.capacidade_m3 ?? 0)));
      if (maiorKg > 0 && p.pesoKg > maiorKg)
        return { pedido: p, motivo: "Peso acima da capacidade de qualquer veículo" };
      if (maiorM3 > 0 && p.volumeM3 > maiorM3)
        return { pedido: p, motivo: "Volume acima da capacidade de qualquer veículo" };
      return { pedido: p, motivo: "Sem espaço nos veículos escolhidos" };
    });

  return { rotas, sobras };
}
