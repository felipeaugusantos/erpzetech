export function inicioProximaConsulta(dia: string, hora: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return null;
  const instante = new Date(`${dia}T${hora}:00-03:00`);
  if (!Number.isFinite(instante.getTime()) || instante.toISOString().slice(0, 10) !== new Date(`${dia}T12:00:00Z`).toISOString().slice(0, 10)) return null;
  return instante.toISOString();
}

export function erroProximaConsulta(dia: string, hora: string, agora = new Date()): string | null {
  const inicio = inicioProximaConsulta(dia, hora);
  if (!inicio) return "Informe uma data e horário válidos.";
  return new Date(inicio) <= agora ? "Escolha uma data e horário futuros." : null;
}