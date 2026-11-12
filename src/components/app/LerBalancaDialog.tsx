import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BAUDS_BALANCA,
  CONFIG_BALANCA_PADRAO,
  lerConfigBalanca,
  pesoParaCampo,
  type ConfigBalanca,
} from "@/lib/balanca-serial";
import {
  LeitorDeBalanca,
  servicoSerialDoNavegador,
  type QuadroLido,
} from "@/lib/balanca-serial-porta";
import { Input } from "@/components/ui/input";

const CHAVE = "balanca-serial";

function configSalva(): ConfigBalanca {
  try {
    return lerConfigBalanca(JSON.parse(localStorage.getItem(CHAVE) ?? "null"));
  } catch {
    return CONFIG_BALANCA_PADRAO;
  }
}

/**
 * Lê o peso da balança ligada ao computador por cabo serial (RS-232 ou USB serial). Cada balança manda os dados de um
 * jeito: a tela mostra o que chega, a pessoa ajusta o formato até o peso aparecer certo e só então usa o peso.
 * Só funciona no Chrome e no Edge para computador, em página segura (https).
 */
export function LerBalancaDialog({
  aberto,
  onClose,
  onPeso,
}: {
  aberto: boolean;
  onClose: () => void;
  /** Peso em gramas, já estável. */
  onPeso: (gramas: number) => void;
}) {
  const [config, setConfig] = useState<ConfigBalanca>(CONFIG_BALANCA_PADRAO);
  const [lendo, setLendo] = useState(false);
  const [ultimo, setUltimo] = useState<QuadroLido | null>(null);
  const [recentes, setRecentes] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const leitor = useRef<LeitorDeBalanca | null>(null);
  const suportado = typeof window !== "undefined" && servicoSerialDoNavegador() !== null;

  useEffect(() => {
    if (aberto) setConfig(configSalva());
  }, [aberto]);

  async function parar() {
    const l = leitor.current;
    leitor.current = null;
    setLendo(false);
    await l?.parar();
  }

  // fechar o diálogo (ou sair da tela) solta a porta
  useEffect(() => {
    if (!aberto) void parar();
    return () => {
      void parar();
    };
  }, [aberto]);

  async function iniciar(trocarPorta: boolean) {
    const serial = servicoSerialDoNavegador();
    if (!serial) return;
    await parar();
    setErro(null);
    setUltimo(null);
    setRecentes([]);
    try {
      localStorage.setItem(CHAVE, JSON.stringify(config));
    } catch {
      /* não é essencial */
    }
    const novo = new LeitorDeBalanca(serial, config, {
      aoQuadro: (q) => {
        setUltimo(q);
        setRecentes((r) => [q.visivel, ...r].slice(0, 6));
      },
      aoErro: (m) => {
        setErro(m);
        setLendo(false);
        leitor.current = null;
      },
    });
    leitor.current = novo;
    try {
      await novo.iniciar({ trocarPorta });
      setLendo(true);
    } catch (e) {
      leitor.current = null;
      setErro(e instanceof Error ? e.message : "Falha ao falar com a balança.");
    }
  }

  const set = <K extends keyof ConfigBalanca>(k: K, v: ConfigBalanca[K]) =>
    setConfig((c) => ({ ...c, [k]: v }));
  const estavel = ultimo?.estavelG ?? null;

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ler o peso da balança</DialogTitle>
          <DialogDescription>
            Ligue a balança no computador por cabo serial ou USB, coloque o produto e escolha a
            porta. O peso só vale quando para de variar.
          </DialogDescription>
        </DialogHeader>

        {!suportado ? (
          <p className="text-sm text-destructive">
            Este navegador não permite ler a porta serial. Use o Chrome ou o Edge no computador, com
            o sistema aberto por https. Enquanto isso, digite o peso.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Velocidade (baud)</Label>
                <Select
                  value={String(config.baudRate)}
                  disabled={lendo}
                  onValueChange={(v) => set("baudRate", Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BAUDS_BALANCA.map((b) => (
                      <SelectItem key={b} value={String(b)}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Paridade</Label>
                <Select
                  value={config.paridade}
                  disabled={lendo}
                  onValueChange={(v) => set("paridade", v as ConfigBalanca["paridade"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhuma</SelectItem>
                    <SelectItem value="even">Par</SelectItem>
                    <SelectItem value="odd">Ímpar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Como o peso vem</Label>
                <Select
                  value={config.formato}
                  disabled={lendo}
                  onValueChange={(v) => set("formato", v as ConfigBalanca["formato"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="decimal">Número com vírgula ou ponto (1,250)</SelectItem>
                    <SelectItem value="inteiro">Só dígitos (001250)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Unidade</Label>
                <Select
                  value={config.unidade}
                  disabled={lendo}
                  onValueChange={(v) => set("unidade", v as ConfigBalanca["unidade"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kg">Quilos</SelectItem>
                    <SelectItem value="g">Gramas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {config.formato === "inteiro" && (
                <div>
                  <Label htmlFor="bal-casas">Casas decimais</Label>
                  <Input
                    id="bal-casas"
                    type="number"
                    min={0}
                    max={4}
                    disabled={lendo}
                    value={config.casas}
                    onChange={(e) =>
                      set(
                        "casas",
                        Math.min(4, Math.max(0, Math.floor(Number(e.target.value)) || 0)),
                      )
                    }
                  />
                </div>
              )}
              <div>
                <Label>Pedir o peso</Label>
                <Select
                  value={config.comando}
                  disabled={lendo}
                  onValueChange={(v) => set("comando", v as ConfigBalanca["comando"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">Não: a balança envia sozinha</SelectItem>
                    <SelectItem value="enq">Sim: enviar ENQ (0x05)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {!lendo ? (
                <Button onClick={() => void iniciar(false)}>Conectar e ler</Button>
              ) : (
                <Button variant="outline" onClick={() => void parar()}>
                  Parar
                </Button>
              )}
              <Button variant="outline" disabled={lendo} onClick={() => void iniciar(true)}>
                Escolher outra porta
              </Button>
            </div>

            {erro && <p className="text-sm text-destructive">{erro}</p>}

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Peso lido</span>
                {ultimo &&
                  (estavel != null ? (
                    <Badge>Parado</Badge>
                  ) : ultimo.pesoG != null ? (
                    <Badge variant="secondary">Variando…</Badge>
                  ) : (
                    <Badge variant="destructive">Sem peso no quadro</Badge>
                  ))}
              </div>
              <p className="text-3xl font-semibold tabular-nums">
                {ultimo?.pesoG != null ? `${pesoParaCampo(ultimo.pesoG)} kg` : "—"}
              </p>
              <div>
                <p className="text-xs text-muted-foreground">
                  O que a balança está mandando (se o peso não aparece certo, ajuste o formato):
                </p>
                <pre className="mt-1 max-h-28 overflow-auto rounded bg-muted p-2 text-xs">
                  {recentes.length > 0 ? recentes.join("\n") : lendo ? "Aguardando dados…" : "—"}
                </pre>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button
            disabled={estavel == null}
            onClick={() => {
              if (estavel == null) return;
              onPeso(estavel);
              toast.success(`Peso ${pesoParaCampo(estavel)} kg lido da balança`);
              onClose();
            }}
          >
            Usar este peso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
