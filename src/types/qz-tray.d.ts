// Só o que o sistema usa do cliente do QZ Tray (a biblioteca não traz tipos).
declare module "qz-tray" {
  interface QzCliente {
    websocket: {
      isActive(): boolean;
      connect(opcoes?: { retries?: number; delay?: number }): Promise<void>;
      disconnect(): Promise<void>;
    };
    printers: {
      find(consulta?: string): Promise<string | string[]>;
      getDefault(): Promise<string>;
    };
    configs: { create(impressora: string, opcoes?: Record<string, unknown>): unknown };
    print(config: unknown, dados: unknown[]): Promise<void>;
  }
  const qz: QzCliente;
  export default qz;
}
