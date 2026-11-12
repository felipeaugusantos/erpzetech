/**
 * Envio direto da etiqueta à impressora pelo QZ Tray (programa instalado no computador do caixa).
 * O navegador conversa com ele por WebSocket local; o sistema não guarda nem envia nada a servidor.
 */
export type ClienteQz = {
  security?: {
    setCertificatePromise(
      f: (resolve: (c: string) => void, reject: (e: unknown) => void) => void,
    ): void;
    setSignaturePromise(
      f: (msg: string) => (resolve: (s: string) => void, reject: (e: unknown) => void) => void,
    ): void;
    setSignatureAlgorithm(a: string): void;
  };
  websocket: {
    isActive(): boolean;
    connect(opcoes?: { retries?: number; delay?: number }): Promise<void>;
  };
  printers: { find(consulta?: string): Promise<string | string[]> };
  configs: { create(impressora: string, opcoes?: Record<string, unknown>): unknown };
  print(config: unknown, dados: unknown[]): Promise<void>;
};

/** Lado do servidor da assinatura: o certificado (ou nada, se não estiver configurado) e a assinatura de cada requisição. */
export type ApiAssinaturaQz = {
  certificado(): Promise<string | null>;
  assinar(mensagem: string): Promise<string>;
};

const assinados = new WeakSet<object>();

/**
 * Liga a assinatura das requisições, uma vez por cliente. Sem certificado configurado no servidor não muda nada:
 * o envio segue sem assinatura e o QZ Tray pede autorização.
 */
export async function configurarAssinaturaQz(
  qz: ClienteQz,
  api?: ApiAssinaturaQz,
): Promise<boolean> {
  if (!qz.security || !api) return false;
  if (assinados.has(qz)) return true;
  let certificado: string | null = null;
  try {
    certificado = await api.certificado();
  } catch {
    return false;
  }
  if (!certificado) return false;
  const cert = certificado;
  qz.security.setSignatureAlgorithm("SHA512");
  qz.security.setCertificatePromise((resolve) => resolve(cert));
  qz.security.setSignaturePromise((msg) => (resolve, reject) => {
    api.assinar(msg).then(resolve, reject);
  });
  assinados.add(qz);
  return true;
}

/** Carrega a biblioteca só quando alguém usa o envio direto (não pesa no resto do sistema). */
export async function carregarQz(): Promise<ClienteQz> {
  const m = await import("qz-tray");
  return m.default as unknown as ClienteQz;
}

export function paraBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export class ErroQz extends Error {}

async function conectar(qz: ClienteQz, api?: ApiAssinaturaQz): Promise<void> {
  if (qz.websocket.isActive()) return;
  await configurarAssinaturaQz(qz, api);
  try {
    await qz.websocket.connect({ retries: 1, delay: 1 });
  } catch {
    throw new ErroQz(
      "Não foi possível falar com o QZ Tray. Ele precisa estar instalado e aberto neste computador.",
    );
  }
}

/** Nomes das impressoras instaladas no computador, em ordem alfabética. */
export async function listarImpressorasQz(
  carregar: () => Promise<ClienteQz> = carregarQz,
  api?: ApiAssinaturaQz,
) {
  const qz = await carregar();
  await conectar(qz, api);
  const r = await qz.printers.find();
  return (Array.isArray(r) ? r : [r]).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Manda os bytes (ZPL ou TSPL) como estão para a impressora, sem passar pelo driver gráfico. */
export async function enviarCrusQz(
  impressora: string,
  bytes: Uint8Array,
  carregar: () => Promise<ClienteQz> = carregarQz,
  api?: ApiAssinaturaQz,
): Promise<void> {
  if (!impressora.trim()) throw new ErroQz("Escolha a impressora.");
  if (bytes.length === 0) throw new ErroQz("Nada para imprimir.");
  const qz = await carregar();
  await conectar(qz, api);
  const config = qz.configs.create(impressora);
  try {
    await qz.print(config, [
      { type: "raw", format: "command", flavor: "base64", data: paraBase64(bytes) },
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ErroQz(`O QZ Tray não imprimiu: ${msg}`);
  }
}
