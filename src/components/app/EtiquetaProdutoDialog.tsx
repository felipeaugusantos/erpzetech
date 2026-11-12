import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import { abrirImpressao } from "@/lib/imprimir";
import { enviarCrusQz, listarImpressorasQz, type ApiAssinaturaQz } from "@/lib/etiqueta-qz";
import { assinarQz, certificadoQz } from "@/lib/etiqueta-qz.functions";
import {
  LINGUAGENS_ETIQUETA,
  bytesEtiquetas,
  comandosEtiquetas,
  type ImpressoraEtiqueta,
  type LinguagemEtiqueta,
} from "@/lib/etiqueta-raw";
import {
  MODELOS_ETIQUETA,
  htmlEtiquetas,
  modeloEtiqueta,
  type DadosEtiqueta,
} from "@/lib/etiqueta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
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

const CHAVE_MODELO = "etiqueta-modelo";
const CHAVE_MODO = "etiqueta-modo";
const CHAVE_QZ = "etiqueta-qz";

// Assinatura das requisições (só funciona se o servidor tiver o certificado e a chave configurados).
const API_ASSINATURA_QZ: ApiAssinaturaQz = {
  certificado: async () => (await certificadoQz()).certificado,
  assinar: async (mensagem) => (await assinarQz({ data: { mensagem } })).assinatura,
};

/** "driver" imprime pelo Windows; os demais baixam um arquivo de comandos para a térmica. */
type Modo = "driver" | LinguagemEtiqueta;

/** Imprime etiquetas de um produto: térmica (via driver da impressora) ou folha A4 (laser/jato). */
export function EtiquetaProdutoDialog({
  itens,
  onClose,
}: {
  /** Itens a imprimir; `copias` de cada um é o valor inicial da quantidade. */
  itens: DadosEtiqueta[] | null;
  onClose: () => void;
}) {
  const [modeloId, setModeloId] = useState("t-50x30");
  const [copias, setCopias] = useState<string[]>([]);
  const [pular, setPular] = useState("0");
  const [preco, setPreco] = useState(true);
  const [codigo, setCodigo] = useState(true);
  const [modo, setModo] = useState<Modo>("driver");
  const [dpi, setDpi] = useState<203 | 300>(203);
  // Entrega do arquivo de comandos: baixar ou enviar direto pelo QZ Tray.
  const [entrega, setEntrega] = useState<"arquivo" | "qz">("arquivo");
  const [impressoraQz, setImpressoraQz] = useState("");
  const [impressoras, setImpressoras] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setCopias((itens ?? []).map((i) => String(i.copias ?? 1)));
  }, [itens]);

  useEffect(() => {
    try {
      const salvo = localStorage.getItem(CHAVE_MODELO);
      if (salvo && modeloEtiqueta(salvo)) setModeloId(salvo);
      const m = localStorage.getItem(CHAVE_MODO)?.split("|");
      if (m && ["driver", "zpl", "tspl"].includes(m[0]!)) setModo(m[0] as Modo);
      if (m?.[1] === "300") setDpi(300);
      const q = localStorage.getItem(CHAVE_QZ)?.split("|");
      if (q?.[0] === "qz") setEntrega("qz");
      if (q?.[1]) {
        setImpressoraQz(q[1]);
        setImpressoras([q[1]]);
      }
    } catch {
      /* sem armazenamento: usa o padrão */
    }
  }, []);

  const modelo = modeloEtiqueta(modeloId)!;
  const folha = modelo.tipo === "folha";
  // A folha A4 só sai pelo driver; o arquivo de comandos é para etiqueta térmica.
  const modoEfetivo: Modo = folha ? "driver" : modo;

  async function buscarImpressoras() {
    setOcupado(true);
    try {
      const lista = await listarImpressorasQz(undefined, API_ASSINATURA_QZ);
      setImpressoras(lista);
      if (!lista.includes(impressoraQz)) setImpressoraQz(lista[0] ?? "");
      if (lista.length === 0) toast.error("O QZ Tray não encontrou nenhuma impressora");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao falar com o QZ Tray");
    } finally {
      setOcupado(false);
    }
  }

  async function imprimir() {
    if (!itens) return;
    const qtd = copias.map((c) => Math.floor(Number(c)));
    if (qtd.some((n) => !Number.isFinite(n) || n < 0 || n > 500) || qtd.every((n) => n === 0)) {
      toast.error("Informe quantidades de 0 a 500, com pelo menos uma etiqueta");
      return;
    }
    try {
      localStorage.setItem(CHAVE_MODELO, modeloId);
      localStorage.setItem(CHAVE_MODO, `${modo}|${dpi}`);
      localStorage.setItem(CHAVE_QZ, `${entrega}|${impressoraQz}`);
    } catch {
      /* não é essencial */
    }
    const escolhidos = itens.map((i, k) => ({ ...i, copias: qtd[k]! })).filter((i) => i.copias > 0);
    if (modoEfetivo !== "driver") {
      const imp: ImpressoraEtiqueta = { linguagem: modoEfetivo, dpi };
      const texto = comandosEtiquetas(modelo, escolhidos, imp, {
        mostrarPreco: preco,
        mostrarCodigo: codigo,
      });
      if (entrega === "qz") {
        setOcupado(true);
        try {
          await enviarCrusQz(
            impressoraQz,
            bytesEtiquetas(texto, modoEfetivo),
            undefined,
            API_ASSINATURA_QZ,
          );
          toast.success("Etiquetas enviadas para a impressora");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Falha ao enviar para o QZ Tray");
        } finally {
          setOcupado(false);
        }
        return;
      }
      const ext = LINGUAGENS_ETIQUETA.find((l) => l.id === modoEfetivo)!.extensao;
      const url = URL.createObjectURL(
        new Blob([bytesEtiquetas(texto, modoEfetivo) as BlobPart], {
          type: "application/octet-stream",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `etiquetas.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    abrirImpressao(
      htmlEtiquetas(modelo, escolhidos, {
        mostrarPreco: preco,
        mostrarCodigo: codigo,
        pular: folha ? Number(pular) || 0 : 0,
      }),
      700,
      600,
    );
  }

  return (
    <Dialog open={!!itens} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Imprimir etiquetas</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {(itens ?? []).map((i, k) => (
              <div key={k} className="flex items-center gap-2">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate font-medium">{i.descricao}</div>
                  {(i.lote || i.validade) && (
                    <div className="text-xs text-muted-foreground">
                      {[i.lote && `Lote ${i.lote}`, i.validade && `Val ${i.validade}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                </div>
                <Input
                  aria-label={`Quantidade de ${i.descricao}`}
                  className="w-20"
                  type="number"
                  min={0}
                  max={500}
                  value={copias[k] ?? "1"}
                  onChange={(e) =>
                    setCopias((c) => c.map((v, j) => (j === k ? e.target.value : v)))
                  }
                />
              </div>
            ))}
          </div>
          <div>
            <Label>Modelo da etiqueta</Label>
            <Select value={modeloId} onValueChange={setModeloId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELOS_ETIQUETA.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!folha && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Como imprimir</Label>
                <Select value={modo} onValueChange={(v) => setModo(v as Modo)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="driver">Driver do sistema</SelectItem>
                    {LINGUAGENS_ETIQUETA.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        Arquivo {l.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {modo !== "driver" && (
                <div>
                  <Label>Resolução</Label>
                  <Select
                    value={String(dpi)}
                    onValueChange={(v) => setDpi(v === "300" ? 300 : 203)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="203">203 dpi (8 pontos/mm)</SelectItem>
                      <SelectItem value="300">300 dpi (12 pontos/mm)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          {!folha && modo !== "driver" && (
            <div className="space-y-2">
              <div>
                <Label>Entrega</Label>
                <Select value={entrega} onValueChange={(v) => setEntrega(v as "arquivo" | "qz")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="arquivo">Baixar arquivo</SelectItem>
                    <SelectItem value="qz">Enviar direto (QZ Tray)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {entrega === "qz" && (
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Label>Impressora</Label>
                    <Select value={impressoraQz} onValueChange={setImpressoraQz}>
                      <SelectTrigger>
                        <SelectValue placeholder="Busque as impressoras" />
                      </SelectTrigger>
                      <SelectContent>
                        {impressoras.map((n) => (
                          <SelectItem key={n} value={n}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={ocupado}
                    onClick={buscarImpressoras}
                  >
                    Buscar
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {folha && (
              <div>
                <Label htmlFor="et-pular">Pular posições</Label>
                <Input
                  id="et-pular"
                  type="number"
                  min={0}
                  value={pular}
                  onChange={(e) => setPular(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="et-preco">Mostrar preço</Label>
            <Switch id="et-preco" checked={preco} onCheckedChange={setPreco} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="et-cod">Mostrar código de barras</Label>
            <Switch id="et-cod" checked={codigo} onCheckedChange={setCodigo} />
          </div>
          <p className="text-xs text-muted-foreground">
            {modoEfetivo !== "driver" && entrega === "qz"
              ? "Envio direto pelo QZ Tray, instalado e aberto neste computador (qz.io). Se o servidor não tiver o certificado configurado, ele pede autorização para este site. Faça um teste com uma etiqueta."
              : modoEfetivo !== "driver"
                ? "O arquivo vai direto para a impressora, sem o driver: com a impressora compartilhada no Windows, no Prompt de Comando use copy /b etiquetas.zpl \\\\localhost\\NOME (ou etiquetas.prn). Confira o tamanho do rolo e faça um teste com uma etiqueta."
                : folha
                  ? "Na janela de impressão, use papel A4, escala 100% e sem margens."
                  : `Na janela de impressão, escolha a impressora térmica com o papel em ${modelo.larguraMm} × ${modelo.alturaMm} mm, escala 100% e sem margens.`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={imprimir} disabled={ocupado}>
            <Printer className="mr-2 size-4" />{" "}
            {modoEfetivo === "driver"
              ? "Imprimir"
              : entrega === "qz"
                ? "Enviar à impressora"
                : "Baixar arquivo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
