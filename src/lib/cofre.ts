// Cofre criptografado do notebook para o trabalho sem internet da clínica. Dado clínico nunca vai para o armazenamento simples do navegador:
// tudo o que o cofre guarda (a fila de gravações e a cópia de consulta) fica cifrado com AES-GCM, com uma chave derivada da senha da pessoa
// (PBKDF2). A chave existe só na memória, enquanto o cofre está aberto; travado ou sem a senha, o conteúdo não abre e não se recupera.
// Este arquivo não depende de tela nem de navegador: o armazenamento entra por uma interface (IndexedDB no navegador, memória nos testes).

export const ITERACOES_PADRAO = 600_000;
export const SENHA_MINIMA = 8;

export type LojaCofre = "fila" | "copia";
type LojaBruta = LojaCofre | "meta" | "arquivo";

/** Onde os registros ficam (já cifrados). */
export interface Armazem {
  ler(loja: LojaBruta, chave: string): Promise<unknown>;
  gravar(loja: LojaBruta, chave: string, valor: unknown): Promise<void>;
  /** Grava só se a chave ainda não existe (atômico); devolve falso se já existia. */
  criarSeNaoExiste(loja: LojaBruta, chave: string, valor: unknown): Promise<boolean>;
  apagar(loja: LojaBruta, chave: string): Promise<void>;
  listar(loja: LojaBruta): Promise<[string, unknown][]>;
  limpar(): Promise<void>;
}

type Cifrado = { v: 1; iv: string; c: string };
type Meta = { v: 1; sal: string; iteracoes: number; verificador: Cifrado };

const VERIFICADOR = "ze-tech-cofre-clinica-v1";
const enc = new TextEncoder();
const dec = new TextDecoder();

function paraBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function deBase64(texto: string): Uint8Array<ArrayBuffer> {
  const s = atob(texto);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function aleatorio(n: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Confere a senha escolhida; devolve a mensagem do primeiro problema. */
export function erroDaSenha(senha: string, confirmacao?: string): string | null {
  if (senha.length < SENHA_MINIMA) return `A senha precisa ter ao menos ${SENHA_MINIMA} caracteres`;
  if (confirmacao !== undefined && senha !== confirmacao) return "As senhas não são iguais";
  return null;
}

async function derivarChave(
  senha: string,
  sal: Uint8Array<ArrayBuffer>,
  iteracoes: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: sal, iterations: iteracoes, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function cifrar(chave: CryptoKey, aad: string, valor: unknown): Promise<Cifrado> {
  const iv = aleatorio(12);
  const c = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(aad) },
    chave,
    enc.encode(JSON.stringify(valor)),
  );
  return { v: 1, iv: paraBase64(iv), c: paraBase64(new Uint8Array(c)) };
}

async function decifrar(chave: CryptoKey, aad: string, dado: Cifrado): Promise<unknown> {
  const claro = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: deBase64(dado.iv), additionalData: enc.encode(aad) },
    chave,
    deBase64(dado.c),
  );
  return JSON.parse(dec.decode(claro));
}

/** Arquivo cifrado: os bytes ficam como estão (sem base64), só cifrados. */
type CifradoBinario = { v: 1; iv: Uint8Array<ArrayBuffer>; c: ArrayBuffer };

async function cifrarBytes(
  chave: CryptoKey,
  aad: string,
  bytes: ArrayBuffer,
): Promise<CifradoBinario> {
  const iv = aleatorio(12);
  const c = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(aad) },
    chave,
    bytes,
  );
  return { v: 1, iv, c };
}

const ehCifradoBinario = (x: unknown): x is CifradoBinario =>
  typeof x === "object" &&
  x !== null &&
  (x as CifradoBinario).v === 1 &&
  (x as CifradoBinario).iv instanceof Uint8Array &&
  (x as CifradoBinario).c instanceof ArrayBuffer;

const ehCifrado = (x: unknown): x is Cifrado =>
  typeof x === "object" &&
  x !== null &&
  (x as Cifrado).v === 1 &&
  typeof (x as Cifrado).iv === "string" &&
  typeof (x as Cifrado).c === "string";

/** Outra aba criou o cofre primeiro: a senha que vale é a dela. */
export class CofreJaExisteError extends Error {
  constructor() {
    super("O cofre já foi criado em outra aba deste notebook: digite a senha dele para destravar");
    this.name = "CofreJaExisteError";
  }
}

export class Cofre {
  private chave: CryptoKey | null = null;
  private readonly armazem: Armazem;
  private readonly iteracoes: number;

  constructor(armazem: Armazem, iteracoes: number = ITERACOES_PADRAO) {
    this.armazem = armazem;
    this.iteracoes = iteracoes;
  }

  get aberto(): boolean {
    return this.chave !== null;
  }

  async existe(): Promise<boolean> {
    return (await this.armazem.ler("meta", "cofre")) !== undefined;
  }

  /** Cria o cofre com a senha escolhida (só quando ainda não existe) e já o deixa aberto. */
  async criar(senha: string): Promise<void> {
    const erro = erroDaSenha(senha);
    if (erro) throw new Error(erro);
    if (await this.existe()) throw new Error("Já existe um cofre neste notebook");
    const sal = aleatorio(16);
    const chave = await derivarChave(senha, sal, this.iteracoes);
    const meta: Meta = {
      v: 1,
      sal: paraBase64(sal),
      iteracoes: this.iteracoes,
      verificador: await cifrar(chave, "meta:verificador", VERIFICADOR),
    };
    // atômico: se outra aba criou entre a conferência e agora, esta perde e não fica "aberta" com uma chave que não vale
    if (!(await this.armazem.criarSeNaoExiste("meta", "cofre", meta)))
      throw new CofreJaExisteError();
    this.chave = chave;
  }

  /** Abre o cofre com a senha; devolve falso se a senha estiver errada. */
  async destravar(senha: string): Promise<boolean> {
    const meta = await this.armazem.ler("meta", "cofre");
    if (!meta) throw new Error("Ainda não existe um cofre neste notebook");
    const m = meta as Meta;
    const chave = await derivarChave(senha, deBase64(m.sal), m.iteracoes);
    try {
      if ((await decifrar(chave, "meta:verificador", m.verificador)) !== VERIFICADOR) return false;
    } catch {
      return false;
    }
    this.chave = chave;
    return true;
  }

  /** Esquece a chave da memória: o conteúdo continua guardado, mas só abre com a senha. */
  travar(): void {
    this.chave = null;
  }

  private exigeAberto(): CryptoKey {
    if (!this.chave) throw new Error("O cofre está travado: digite a senha");
    return this.chave;
  }

  async gravar(loja: LojaCofre, chave: string, valor: unknown): Promise<void> {
    await this.armazem.gravar(
      loja,
      chave,
      await cifrar(this.exigeAberto(), `${loja}:${chave}`, valor),
    );
  }

  async ler<T>(loja: LojaCofre, chave: string): Promise<T | undefined> {
    const k = this.exigeAberto();
    const dado = await this.armazem.ler(loja, chave);
    if (dado === undefined) return undefined;
    if (!ehCifrado(dado)) throw new Error("Registro do cofre ilegível");
    return (await decifrar(k, `${loja}:${chave}`, dado)) as T;
  }

  /** Todos os registros da loja; os que não abrem (adulterados ou de outra senha) vêm à parte, nunca somem calados. */
  async listar<T>(loja: LojaCofre): Promise<{ itens: [string, T][]; ilegiveis: string[] }> {
    const k = this.exigeAberto();
    const itens: [string, T][] = [];
    const ilegiveis: string[] = [];
    for (const [chave, dado] of await this.armazem.listar(loja)) {
      try {
        if (!ehCifrado(dado)) throw new Error("formato");
        itens.push([chave, (await decifrar(k, `${loja}:${chave}`, dado)) as T]);
      } catch {
        ilegiveis.push(chave);
      }
    }
    return { itens, ilegiveis };
  }

  /** Guarda um arquivo (anexo) cifrado, à parte dos registros de texto: ele nunca entra em `listar`. */
  async gravarArquivo(chave: string, bytes: ArrayBuffer): Promise<void> {
    await this.armazem.gravar(
      "arquivo",
      chave,
      await cifrarBytes(this.exigeAberto(), `arquivo:${chave}`, bytes),
    );
  }

  async lerArquivo(chave: string): Promise<ArrayBuffer | undefined> {
    const k = this.exigeAberto();
    const dado = await this.armazem.ler("arquivo", chave);
    if (dado === undefined) return undefined;
    if (!ehCifradoBinario(dado)) throw new Error("Arquivo do cofre ilegível");
    return crypto.subtle.decrypt(
      { name: "AES-GCM", iv: dado.iv, additionalData: enc.encode(`arquivo:${chave}`) },
      k,
      dado.c,
    );
  }

  /** Sem erro se o arquivo não existe (descartar uma operação sem arquivo é comum). */
  async apagarArquivo(chave: string): Promise<void> {
    this.exigeAberto();
    await this.armazem.apagar("arquivo", chave);
  }

  async apagar(loja: LojaCofre, chave: string): Promise<void> {
    this.exigeAberto();
    await this.armazem.apagar(loja, chave);
  }

  /** Apaga tudo: senha, fila, cópia e arquivos. Sem volta. */
  async apagarTudo(): Promise<void> {
    await this.armazem.limpar();
    this.chave = null;
  }
}

/** Armazém em memória (testes). */
export function armazemEmMemoria(): Armazem & { bruto: Map<string, unknown> } {
  const bruto = new Map<string, unknown>();
  const k = (loja: string, chave: string) => `${loja}\u0000${chave}`;
  return {
    bruto,
    async ler(loja, chave) {
      return bruto.get(k(loja, chave));
    },
    async gravar(loja, chave, valor) {
      bruto.set(k(loja, chave), structuredClone(valor));
    },
    async criarSeNaoExiste(loja, chave, valor) {
      if (bruto.has(k(loja, chave))) return false;
      bruto.set(k(loja, chave), structuredClone(valor));
      return true;
    },
    async apagar(loja, chave) {
      bruto.delete(k(loja, chave));
    },
    async listar(loja) {
      return [...bruto.entries()]
        .filter(([c]) => c.startsWith(`${loja}\u0000`))
        .map(([c, v]) => [c.slice(loja.length + 1), v] as [string, unknown]);
    },
    async limpar() {
      bruto.clear();
    },
  };
}
