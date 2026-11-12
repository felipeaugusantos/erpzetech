import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONFIG_BALANCA_PADRAO,
  EstabilizadorDePeso,
  ExtratorDeQuadros,
  lerConfigBalanca,
  pesoDoQuadro,
  pesoParaCampo,
  quadroVisivel,
} from "../src/lib/balanca-serial.ts";

const DEC = { formato: "decimal", casas: 3, unidade: "kg" } as const;

test("quadros: junta pedaços, separa por CR, LF, STX e ETX e ignora quadros vazios", () => {
  const e = new ExtratorDeQuadros();
  assert.deepEqual(e.empurrar("1,2"), []);
  assert.deepEqual(e.empurrar("50\r\n1,2"), ["1,250"]);
  assert.deepEqual(e.empurrar("60\r"), ["1,260"]);
  assert.deepEqual(e.empurrar("\x02001250\x03\x02001255\x03"), ["001250", "001255"]);
  assert.deepEqual(e.empurrar("\r\n\r\n"), []);
});

test("quadros: sem terminador, entrega quando passa do limite (não acumula sem fim)", () => {
  const e = new ExtratorDeQuadros(10);
  assert.deepEqual(e.empurrar("12345"), []);
  assert.deepEqual(e.empurrar("67890123"), ["1234567890123"]);
  assert.deepEqual(e.empurrar("45\n"), ["45"]);
});

test("quadro visível mostra os caracteres de controle", () => {
  assert.equal(quadroVisivel("\x02001250\x03\r\n"), "<STX>001250<ETX><CR><LF>");
  assert.equal(quadroVisivel("\x05\x00"), "<ENQ><0x00>");
  assert.equal(quadroVisivel("  1,250 kg"), "  1,250 kg");
});

test("peso decimal: ponto ou vírgula, com texto em volta, em kg ou em g", () => {
  assert.equal(pesoDoQuadro("  1,250 kg", DEC), 1250);
  assert.equal(pesoDoQuadro("ST,GS,   0.850kg", DEC), 850);
  assert.equal(pesoDoQuadro("0,005", DEC), 5);
  assert.equal(pesoDoQuadro("850", { ...DEC, unidade: "g" }), 850);
  assert.equal(pesoDoQuadro("1,5 kg", { ...DEC, unidade: "g" }), 2); // 1,5 g arredonda
});

test("peso inteiro: dígitos com casas decimais implícitas", () => {
  assert.equal(pesoDoQuadro("001250", { formato: "inteiro", casas: 3, unidade: "kg" }), 1250);
  assert.equal(pesoDoQuadro("00850", { formato: "inteiro", casas: 0, unidade: "g" }), 850);
  assert.equal(pesoDoQuadro("0125", { formato: "inteiro", casas: 2, unidade: "kg" }), 1250);
  assert.equal(pesoDoQuadro("N", { formato: "inteiro", casas: 3, unidade: "kg" }), null);
});

test("peso inválido: zero, negativo, fora do limite e quadro sem número", () => {
  for (const q of ["0,000", "-0,500", "31,000", "99999", "", "ERRO", "I", "---"]) {
    assert.equal(pesoDoQuadro(q, DEC), null, JSON.stringify(q));
  }
  assert.equal(pesoDoQuadro("30,000", DEC), 30000);
});

test("estabilidade: N leituras iguais seguidas; mudança ou leitura inválida reinicia", () => {
  const e = new EstabilizadorDePeso(3);
  assert.deepEqual(
    [850, 850, 850].map((g) => e.ler(g)),
    [null, null, 850],
  );
  assert.equal(e.ler(850), 850); // segue estável
  assert.equal(e.ler(860), null); // mudou
  assert.deepEqual(
    [860, 860].map((g) => e.ler(g)),
    [null, 860],
  );
  assert.equal(e.ler(null), null); // quadro inválido zera
  assert.deepEqual(
    [860, 860, 860].map((g) => e.ler(g)),
    [null, null, 860],
  );
});

test("configuração: aceita o que é válido e volta ao padrão no resto", () => {
  assert.deepEqual(lerConfigBalanca(null), CONFIG_BALANCA_PADRAO);
  assert.deepEqual(lerConfigBalanca("lixo"), CONFIG_BALANCA_PADRAO);
  const c = lerConfigBalanca({
    baudRate: 4800,
    paridade: "even",
    formato: "inteiro",
    casas: 2,
    unidade: "g",
    comando: "enq",
    estavel: 5,
  });
  assert.deepEqual(c, {
    baudRate: 4800,
    paridade: "even",
    formato: "inteiro",
    casas: 2,
    unidade: "g",
    comando: "enq",
    estavel: 5,
  });
  assert.deepEqual(
    lerConfigBalanca({
      baudRate: 1234,
      paridade: "x",
      formato: "y",
      casas: 9,
      unidade: "t",
      comando: "z",
      estavel: 1,
    }),
    CONFIG_BALANCA_PADRAO,
  );
});

test("peso para o campo: kg com vírgula e 3 casas, sem separador de milhar", () => {
  assert.equal(pesoParaCampo(850), "0,850");
  assert.equal(pesoParaCampo(1250), "1,250");
  assert.equal(pesoParaCampo(30000), "30,000");
});

test("o peso lido preenche o campo e o campo reconhece o mesmo peso", async () => {
  const { pesoEmGramas } = await import("../src/lib/pesagem.ts");
  for (const g of [1, 850, 1250, 30000]) assert.equal(pesoEmGramas(pesoParaCampo(g), "kg"), g);
});

// ---- leitor da porta, com uma porta de mentira ----
import {
  LeitorDeBalanca,
  servicoSerialDoNavegador,
  type PortaSerial,
} from "../src/lib/balanca-serial-porta.ts";

function portaFalsa(opts: { falhaAoAbrir?: Error } = {}) {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const escritos: number[][] = [];
  const estado = { aberta: false, fechada: false, aberturaCom: undefined as unknown };
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
    },
    cancel() {
      /* leitor cancelou */
    },
  });
  const porta: PortaSerial = {
    async open(o) {
      if (opts.falhaAoAbrir) throw opts.falhaAoAbrir;
      estado.aberta = true;
      estado.aberturaCom = o;
    },
    async close() {
      estado.fechada = true;
    },
    readable,
    writable: new WritableStream<Uint8Array>({ write: (c) => void escritos.push([...c]) }),
  };
  const enviar = (t: string) => ctl.enqueue(new TextEncoder().encode(t));
  return {
    porta,
    estado,
    escritos,
    enviar,
    fecharDoLadoDeLa: () => ctl.close(),
    quebrar: (e: Error) => ctl.error(e),
  };
}
const servico = (portas: PortaSerial[], pedida?: PortaSerial) => ({
  getPorts: async () => portas,
  requestPort: async () => {
    if (!pedida) throw Object.assign(new Error("sem escolha"), { name: "NotFoundError" });
    return pedida;
  },
});
const espera = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test("leitor: abre a porta com a configuração, entrega os quadros e acha o peso estável", async () => {
  const f = portaFalsa();
  const quadros: { visivel: string; pesoG: number | null; estavelG: number | null }[] = [];
  const l = new LeitorDeBalanca(
    servico([f.porta]),
    { ...CONFIG_BALANCA_PADRAO, baudRate: 4800, estavel: 3 },
    {
      aoQuadro: (q) => quadros.push(q),
      aoErro: (m) => assert.fail(m),
    },
  );
  await l.iniciar();
  assert.deepEqual(f.estado.aberturaCom, {
    baudRate: 4800,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
  });
  f.enviar("  1,2");
  f.enviar("50 kg\r\n  1,250 kg\r\n  1,250");
  f.enviar(" kg\r\n");
  await espera();
  assert.deepEqual(
    quadros.map((q) => q.pesoG),
    [1250, 1250, 1250],
  );
  assert.deepEqual(
    quadros.map((q) => q.estavelG),
    [null, null, 1250],
  );
  assert.equal(quadros[0]!.visivel, "  1,250 kg");
  await l.parar();
  assert.equal(f.estado.fechada, true);
  assert.equal(l.ativo, false);
});

test("leitor: no modo ENQ pede o peso (0x05) sem parar, e deixa de pedir ao parar", async () => {
  const f = portaFalsa();
  const l = new LeitorDeBalanca(
    servico([f.porta]),
    { ...CONFIG_BALANCA_PADRAO, comando: "enq" },
    {
      aoQuadro: () => {},
      aoErro: (m) => assert.fail(m),
    },
  );
  await l.iniciar();
  await espera(900);
  assert.ok(f.escritos.length >= 2, `pediu ${f.escritos.length} vezes`);
  assert.ok(f.escritos.every((e) => e.length === 1 && e[0] === 5));
  await l.parar();
  const total = f.escritos.length;
  await espera(500);
  assert.equal(f.escritos.length, total);
});

test("leitor: sem porta já autorizada pede a escolha; várias autorizadas também; trocar de porta sempre pede", async () => {
  const a = portaFalsa();
  const b = portaFalsa();
  const c = portaFalsa();
  const ouv = { aoQuadro: () => {}, aoErro: () => {} };
  const uma = new LeitorDeBalanca(servico([a.porta], c.porta), CONFIG_BALANCA_PADRAO, ouv);
  await uma.iniciar();
  assert.equal(a.estado.aberta, true); // uma só autorizada: usa ela
  await uma.parar();
  const duas = new LeitorDeBalanca(
    servico([a.porta, b.porta], c.porta),
    CONFIG_BALANCA_PADRAO,
    ouv,
  );
  await duas.iniciar();
  assert.equal(c.estado.aberta, true); // várias: pede
  await duas.parar();
  const d = portaFalsa();
  const troca = new LeitorDeBalanca(servico([a.porta], d.porta), CONFIG_BALANCA_PADRAO, ouv);
  await troca.iniciar({ trocarPorta: true });
  assert.equal(d.estado.aberta, true);
  await troca.parar();
});

test("leitor: erros viram mensagens claras e deixam o leitor parado", async () => {
  const sem = new LeitorDeBalanca(servico([]), CONFIG_BALANCA_PADRAO, {
    aoQuadro: () => {},
    aoErro: () => {},
  });
  await assert.rejects(sem.iniciar(), /Nenhuma porta foi escolhida/);
  assert.equal(sem.ativo, false);
  const ocupada = portaFalsa({
    falhaAoAbrir: Object.assign(new Error("x"), { name: "InvalidStateError" }),
  });
  const l = new LeitorDeBalanca(servico([ocupada.porta]), CONFIG_BALANCA_PADRAO, {
    aoQuadro: () => {},
    aoErro: () => {},
  });
  await assert.rejects(l.iniciar(), /já está aberta/);
  const falha = portaFalsa({
    falhaAoAbrir: Object.assign(new Error("Failed to open serial port."), { name: "NetworkError" }),
  });
  await assert.rejects(
    new LeitorDeBalanca(servico([falha.porta]), CONFIG_BALANCA_PADRAO, {
      aoQuadro: () => {},
      aoErro: () => {},
    }).iniciar(),
    /confira o cabo/,
  );
});

test("leitor: cabo solto no meio da leitura avisa e fecha a porta", async () => {
  const f = portaFalsa();
  const erros: string[] = [];
  const l = new LeitorDeBalanca(servico([f.porta]), CONFIG_BALANCA_PADRAO, {
    aoQuadro: () => {},
    aoErro: (m) => erros.push(m),
  });
  await l.iniciar();
  f.quebrar(Object.assign(new Error("device lost"), { name: "NetworkError" }));
  await espera();
  assert.equal(erros.length, 1); // avisa uma vez só
  assert.equal(l.ativo, false);
  assert.equal(f.estado.fechada, true);
});

test("leitor: a porta que encerra o fluxo sozinha também avisa e fecha", async () => {
  const f = portaFalsa();
  const erros: string[] = [];
  const l = new LeitorDeBalanca(servico([f.porta]), CONFIG_BALANCA_PADRAO, {
    aoQuadro: () => {},
    aoErro: (m) => erros.push(m),
  });
  await l.iniciar();
  f.fecharDoLadoDeLa();
  await espera();
  assert.deepEqual(erros, ["A balança parou de enviar dados (cabo solto ou balança desligada?)."]);
  assert.equal(f.estado.fechada, true);
  assert.equal(l.ativo, false);
});

test("serviço do navegador: só existe quando o navegador tem Web Serial", () => {
  assert.equal(servicoSerialDoNavegador({}), null);
  assert.equal(servicoSerialDoNavegador(undefined), null);
  const s = { getPorts: async () => [], requestPort: async () => ({}) };
  assert.equal(servicoSerialDoNavegador({ serial: s }), s);
});
