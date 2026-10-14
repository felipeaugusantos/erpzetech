// Congela o relógio sem depender de mock.timers (funciona no Node e no Bun).
export function comRelogio<T>(iso: string, fn: () => T): T {
  const Original = globalThis.Date;
  const agora = new Original(iso).getTime();
  class DataFixa extends Original {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(agora);
      // @ts-expect-error repassa os argumentos do Date original
      else super(...args);
    }
    static override now() {
      return agora;
    }
  }
  globalThis.Date = DataFixa as DateConstructor;
  try {
    return fn();
  } finally {
    globalThis.Date = Original;
  }
}
