/**
 * Roda uma sequência de gravações que não cabe numa transação (usuário no Auth, empresa e perfil no banco).
 * Cada etapa que deu certo registra como desfazê-la; se uma etapa seguinte falhar, os desfazeres rodam do
 * último para o primeiro e o erro original é repassado.
 */
export async function comDesfazer<T>(
  corpo: (desfazerSe: (desfazer: () => Promise<unknown>) => void) => Promise<T>,
): Promise<T> {
  const pilha: (() => Promise<unknown>)[] = [];
  try {
    return await corpo((d) => pilha.push(d));
  } catch (erro) {
    for (const desfazer of pilha.reverse()) {
      try {
        await desfazer();
      } catch {
        // desfazer o que der; o erro que importa é o original
      }
    }
    throw erro;
  }
}
