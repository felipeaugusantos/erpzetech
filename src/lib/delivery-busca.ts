// Delivery: achar o cliente pelo telefone (nos pedidos anteriores e no cadastro de clientes) e a zona de entrega pelo bairro.
// Sem dependência de tela nem de banco.
import { soDigitos } from "./delivery.ts";

/** Telefone só com números, sem o 55 do país quando vem com ele. */
function normalizar(telefone: string): string {
  const d = soDigitos(telefone);
  return d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
}

/**
 * Mesmo telefone mesmo escrito de jeitos diferentes: com ou sem 55, com ou sem DDD e com ou sem o 9 na frente. Vale o final de 8 dígitos; quando
 * os dois têm DDD, o DDD também precisa ser o mesmo. Menos de 8 números não serve para comparar.
 */
export function mesmoTelefone(a: string, b: string): boolean {
  const x = normalizar(a);
  const y = normalizar(b);
  if (x.length < 8 || y.length < 8) return false;
  if (x.slice(-8) !== y.slice(-8)) return false;
  return x.length >= 10 && y.length >= 10 ? x.slice(0, 2) === y.slice(0, 2) : true;
}

export type ContatoEncontrado = {
  origem: "pedido" | "cliente";
  nome: string;
  endereco: string;
  bairro: string;
  referencia: string;
};

export type PedidoAnterior = {
  cliente_nome: string | null;
  entrega_telefone: string | null;
  entrega_endereco: string | null;
  entrega_bairro: string | null;
  entrega_referencia: string | null;
};

export type ClienteCadastro = {
  nome: string | null;
  telefone: string | null;
  whatsapp: string | null;
  endereco: string | null;
  numero: string | null;
  bairro: string | null;
};

/**
 * Quem tem esse telefone: o pedido de delivery mais recente (a lista vem do mais novo para o mais antigo) ou, se nunca pediu, o cadastro de
 * clientes (telefone ou WhatsApp). Cadastro sem nenhum dado útil não conta.
 */
export function acharContato(
  telefone: string,
  pedidos: readonly PedidoAnterior[],
  clientes: readonly ClienteCadastro[],
): ContatoEncontrado | null {
  const pedido = pedidos.find((p) => mesmoTelefone(telefone, p.entrega_telefone ?? ""));
  if (pedido)
    return {
      origem: "pedido",
      nome: pedido.cliente_nome ?? "",
      endereco: pedido.entrega_endereco ?? "",
      bairro: pedido.entrega_bairro ?? "",
      referencia: pedido.entrega_referencia ?? "",
    };
  const cliente = clientes.find(
    (c) => mesmoTelefone(telefone, c.telefone ?? "") || mesmoTelefone(telefone, c.whatsapp ?? ""),
  );
  if (!cliente) return null;
  const endereco = [cliente.endereco, cliente.numero]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(", ");
  const contato: ContatoEncontrado = {
    origem: "cliente",
    nome: (cliente.nome ?? "").trim(),
    endereco,
    bairro: (cliente.bairro ?? "").trim(),
    referencia: "",
  };
  return contato.nome || contato.endereco || contato.bairro ? contato : null;
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export type ZonaBusca = { id: string; nome: string; ativo: boolean };

/** Zona de entrega do bairro: nome igual (sem acento nem caixa) ou, não havendo, um nome contido no outro (a partir de 4 letras). */
export function zonaDoBairro<T extends ZonaBusca>(bairro: string, zonas: readonly T[]): T | null {
  const b = semAcento(bairro);
  if (b.length < 3) return null;
  const ativas = zonas.filter((z) => z.ativo);
  const igual = ativas.find((z) => semAcento(z.nome) === b);
  if (igual) return igual;
  return (
    ativas.find((z) => {
      const n = semAcento(z.nome);
      return n.length >= 4 && b.length >= 4 && (n.includes(b) || b.includes(n));
    }) ?? null
  );
}
