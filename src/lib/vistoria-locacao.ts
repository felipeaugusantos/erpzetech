// Vistoria na devolução de locação: formulário, conferências e o acerto do dano com a caução (o banco confere de novo ao gravar).

export type AvariaForm = { descricao: string; valor: string; perdaTotal: boolean };

export type VistoriaForm = {
  equipamentoId: string;
  nome: string;
  /** Valor de aquisição cadastrado: sugestão de valor para a perda total. */
  valorAquisicao: number;
  avarias: AvariaForm[];
  observacoes: string;
};

/** Número digitado com vírgula ou ponto; vazio vira nulo e texto que não é número vira NaN. */
export function valorDigitado(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

export const avariaVazia = (): AvariaForm => ({ descricao: "", valor: "", perdaTotal: false });

/** Valor sugerido quando o equipamento foi perdido ou inutilizado: o de aquisição, que a pessoa pode ajustar. */
export const valorSugeridoPerdaTotal = (valorAquisicao: number): string =>
  valorAquisicao > 0 ? valorAquisicao.toFixed(2).replace(".", ",") : "";

export function totalDasAvarias(vistorias: readonly Pick<VistoriaForm, "avarias">[]): number {
  let total = 0;
  for (const v of vistorias)
    for (const a of v.avarias) {
      const n = valorDigitado(a.valor);
      if (n !== null && Number.isFinite(n)) total += n;
    }
  return Math.round(total * 100) / 100;
}

/** Dano sai primeiro da caução; o que passar vira cobrança e o que sobrar da caução é devolvido ao cliente. */
export function acertoDaCaucao(caucao: number, dano: number) {
  const c = Math.max(caucao, 0);
  const abatida = Math.min(c, dano);
  return {
    abatida: Math.round(abatida * 100) / 100,
    aCobrar: Math.round((dano - abatida) * 100) / 100,
    aDevolver: Math.round((c - abatida) * 100) / 100,
  };
}

/** Mensagem do primeiro problema (as regras do banco), ou nulo se pode confirmar. */
export function erroDaVistoria(vistorias: readonly VistoriaForm[]): string | null {
  for (const v of vistorias) {
    if (v.observacoes.length > 1000) return `${v.nome}: a observação passa de 1000 letras`;
    for (const a of v.avarias) {
      const d = a.descricao.trim();
      if (d.length < 1 || d.length > 200) return `${v.nome}: descreva cada avaria (até 200 letras)`;
      const n = valorDigitado(a.valor);
      if (n === null) return `${v.nome}: informe o valor de "${d}" (pode ser zero)`;
      if (!Number.isFinite(n) || n >= 1_000_000_000) return `${v.nome}: confira o valor de "${d}"`;
    }
  }
  return null;
}

/** O que vai para o banco: um item por equipamento; sem avarias é vistoria sem dano. */
export function vistoriasParaEnvio(vistorias: readonly VistoriaForm[]) {
  return vistorias.map((v) => ({
    equipamento_id: v.equipamentoId,
    observacoes: v.observacoes.trim(),
    avarias: v.avarias.map((a) => ({
      descricao: a.descricao.trim(),
      valor: String(valorDigitado(a.valor) ?? 0),
      perda_total: a.perdaTotal,
    })),
  }));
}
