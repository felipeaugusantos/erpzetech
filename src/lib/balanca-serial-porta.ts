import {
  EstabilizadorDePeso,
  ExtratorDeQuadros,
  pesoDoQuadro,
  quadroVisivel,
  type ConfigBalanca,
} from "./balanca-serial.ts";

// Só o que usamos da Web Serial (os tipos dela não vêm com o TypeScript). Funciona no Chrome e no Edge para computador,
// em página segura (https ou localhost) e só depois de a pessoa escolher a porta num clique.
export interface PortaSerial {
  open(opcoes: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: "none" | "even" | "odd";
  }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
export interface ServicoSerial {
  getPorts(): Promise<PortaSerial[]>;
  requestPort(opcoes?: object): Promise<PortaSerial>;
}

export const servicoSerialDoNavegador = (
  nav: unknown = typeof navigator === "undefined" ? undefined : navigator,
): ServicoSerial | null => {
  const s = (nav as { serial?: ServicoSerial } | undefined)?.serial;
  return s && typeof s.requestPort === "function" ? s : null;
};

export type QuadroLido = {
  /** O quadro como a balança mandou, com os caracteres de controle visíveis (`<STX>001250<ETX>`). */
  visivel: string;
  /** Peso em gramas achado no quadro, ou null se o quadro não tem peso válido. */
  pesoG: number | null;
  /** Peso em gramas quando parou (leituras iguais seguidas); null enquanto oscila. */
  estavelG: number | null;
};

export type OuvintesBalanca = {
  aoQuadro: (q: QuadroLido) => void;
  aoErro: (mensagem: string) => void;
};

const ENQ = Uint8Array.of(0x05);
const INTERVALO_ENQ_MS = 400;

/**
 * Lê a balança até `parar()`. Abre a porta já autorizada nesta máquina (se só houver uma) ou pede para a pessoa escolher;
 * a escolha só funciona dentro de um clique, por isso `iniciar()` deve ser chamado direto de um botão.
 */
export class LeitorDeBalanca {
  private porta: PortaSerial | null = null;
  private leitor: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private escritor: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private laco: Promise<void> | null = null;
  private parado = true;
  private readonly serial: ServicoSerial;
  private readonly config: ConfigBalanca;
  private readonly ouvintes: OuvintesBalanca;

  constructor(serial: ServicoSerial, config: ConfigBalanca, ouvintes: OuvintesBalanca) {
    this.serial = serial;
    this.config = config;
    this.ouvintes = ouvintes;
  }

  get ativo() {
    return !this.parado;
  }

  async iniciar(opcoes: { trocarPorta?: boolean } = {}): Promise<void> {
    if (!this.parado) return;
    this.parado = false;
    try {
      let porta: PortaSerial | undefined;
      if (!opcoes.trocarPorta) {
        const conhecidas = await this.serial.getPorts();
        if (conhecidas.length === 1) porta = conhecidas[0];
      }
      porta ??= await this.serial.requestPort();
      await porta.open({
        baudRate: this.config.baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: this.config.paridade,
      });
      this.porta = porta;
      if (!porta.readable) throw new Error("A porta abriu, mas não permite leitura.");
      this.leitor = porta.readable.getReader();
      if (this.config.comando === "enq" && porta.writable) {
        this.escritor = porta.writable.getWriter();
        const pedir = () => {
          this.escritor?.write(ENQ).catch(() => {});
        };
        pedir();
        this.timer = setInterval(pedir, INTERVALO_ENQ_MS);
      }
      this.laco = this.ler();
    } catch (e) {
      await this.limpar();
      this.parado = true;
      throw new Error(mensagemDeErroSerial(e));
    }
  }

  private async ler(): Promise<void> {
    const leitor = this.leitor!;
    const decodificador = new TextDecoder("iso-8859-1");
    const extrator = new ExtratorDeQuadros();
    const estabilizador = new EstabilizadorDePeso(this.config.estavel);
    let avisou = false;
    try {
      while (!this.parado) {
        const { value, done } = await leitor.read();
        if (done) break;
        if (!value) continue;
        for (const quadro of extrator.empurrar(decodificador.decode(value, { stream: true }))) {
          const pesoG = pesoDoQuadro(quadro, this.config);
          this.ouvintes.aoQuadro({
            visivel: quadroVisivel(quadro),
            pesoG,
            estavelG: estabilizador.ler(pesoG),
          });
        }
      }
    } catch (e) {
      if (!this.parado) {
        avisou = true;
        this.ouvintes.aoErro(mensagemDeErroSerial(e));
      }
    }
    if (!this.parado) {
      // a porta fechou sozinha (cabo solto, balança desligada): avisa uma vez e fecha tudo
      if (!avisou) {
        this.ouvintes.aoErro("A balança parou de enviar dados (cabo solto ou balança desligada?).");
      }
      this.laco = null; // este laço é quem está fechando: `limpar` não pode esperar por ele mesmo
      await this.parar();
    }
  }

  async parar(): Promise<void> {
    this.parado = true;
    await this.limpar();
  }

  private async limpar(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const leitor = this.leitor;
    const escritor = this.escritor;
    const porta = this.porta;
    this.leitor = this.escritor = this.porta = null;
    try {
      await leitor?.cancel();
    } catch {
      /* já estava fechado */
    }
    try {
      await this.laco;
    } catch {
      /* o laço já tratou o erro */
    }
    this.laco = null;
    try {
      leitor?.releaseLock();
    } catch {
      /* ainda lendo */
    }
    try {
      await escritor?.close();
    } catch {
      /* já estava fechado */
    }
    try {
      await porta?.close();
    } catch {
      /* já estava fechada */
    }
  }
}

export function mensagemDeErroSerial(e: unknown): string {
  const nome = (e as { name?: string })?.name;
  const msg = e instanceof Error ? e.message : String(e);
  if (nome === "NotFoundError") return "Nenhuma porta foi escolhida.";
  if (nome === "SecurityError") return "O navegador não liberou a porta serial para esta página.";
  if (nome === "InvalidStateError" || /already open/i.test(msg))
    return "A porta já está aberta (outro programa ou outra aba está usando a balança).";
  if (nome === "NetworkError" || /failed to open|access denied/i.test(msg))
    return "Não foi possível abrir a porta: confira o cabo, a velocidade e se outro programa não a está usando.";
  return msg || "Falha ao falar com a balança.";
}
