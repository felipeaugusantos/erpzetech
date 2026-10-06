// Maquininha simulada: gera uma resposta de exemplo (NSU, autorização, bandeira) para testar a venda no
// cartão de ponta a ponta antes de ligar a ponte real. Passa pelos mesmos caminhos do TEF verdadeiro.
export const CREDENCIADORA_SIMULADA = "simulado";
export const MOTIVO_RECUSA_SIMULADA = "Simulação: cartão recusado";
export const BANDEIRAS_SIMULADAS = ["Visa", "Mastercard", "Elo"] as const;

export type RespostaSimulada = {
  credenciadora: string;
  nsu: string;
  autorizacao: string;
  bandeira: string;
  simulada: true;
};

const seis = (n: number) => String(Math.floor(n) % 1_000_000).padStart(6, "0");

export function gerarRespostaSimulada(
  opcoes: { bandeira?: string; agora?: Date; sorteio?: () => number } = {},
): RespostaSimulada {
  const agora = opcoes.agora ?? new Date();
  const sorteio = opcoes.sorteio ?? Math.random;
  return {
    credenciadora: CREDENCIADORA_SIMULADA,
    nsu: "SIM-" + seis(agora.getTime() / 1000),
    autorizacao: seis(sorteio() * 1_000_000),
    bandeira:
      opcoes.bandeira ||
      BANDEIRAS_SIMULADAS[Math.floor(sorteio() * BANDEIRAS_SIMULADAS.length) % 3],
    simulada: true,
  };
}

export const ehSimulado = (nsu: string | null | undefined) => (nsu ?? "").startsWith("SIM-");
