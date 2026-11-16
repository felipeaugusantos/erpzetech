export function inicioProximaConsulta(dia: string, hora: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return null;
  const instante = new Date(`${dia}T${hora}:00-03:00`);
  const data = new Date(`${dia}T12:00:00Z`);
  if (!Number.isFinite(instante.getTime()) || !Number.isFinite(data.getTime()) || data.toISOString().slice(0, 10) !== dia) return null;
  return instante.toISOString();
}

export function erroProximaConsulta(dia: string, hora: string, agora = new Date()): string | null {
  const inicio = inicioProximaConsulta(dia, hora);
  if (!inicio) return "Informe uma data e horário válidos.";
  return new Date(inicio) <= agora ? "Escolha uma data e horário futuros." : null;
}

export const ANTECEDENCIA_CONSULTA_MS = 24 * 60 * 60 * 1000;

export function consultaProxima(inicio: string, situacao: string, agora = Date.now()): boolean {
  if (situacao !== "agendado" && situacao !== "confirmado") return false;
  const restante = new Date(inicio).getTime() - agora;
  return restante > 0 && restante <= ANTECEDENCIA_CONSULTA_MS;
}