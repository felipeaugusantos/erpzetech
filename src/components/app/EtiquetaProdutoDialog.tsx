import { useEffect, useState } from "react";
import { Printer } from "lucide-react";

import { abrirImpressao } from "@/lib/imprimir";
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

/** Imprime etiquetas de um produto: térmica (via driver da impressora) ou folha A4 (laser/jato). */
export function EtiquetaProdutoDialog({
  produto,
  onClose,
}: {
  produto: DadosEtiqueta | null;
  onClose: () => void;
}) {
  const [modeloId, setModeloId] = useState("t-50x30");
  const [copias, setCopias] = useState("1");
  const [pular, setPular] = useState("0");
  const [preco, setPreco] = useState(true);
  const [codigo, setCodigo] = useState(true);

  useEffect(() => {
    try {
      const salvo = localStorage.getItem(CHAVE_MODELO);
      if (salvo && modeloEtiqueta(salvo)) setModeloId(salvo);
    } catch {
      /* sem armazenamento: usa o padrão */
    }
  }, []);

  const modelo = modeloEtiqueta(modeloId)!;
  const folha = modelo.tipo === "folha";

  function imprimir() {
    if (!produto) return;
    const n = Math.floor(Number(copias));
    if (!Number.isFinite(n) || n < 1 || n > 500) return;
    try {
      localStorage.setItem(CHAVE_MODELO, modeloId);
    } catch {
      /* não é essencial */
    }
    abrirImpressao(
      htmlEtiquetas(modelo, [{ ...produto, copias: n }], {
        mostrarPreco: preco,
        mostrarCodigo: codigo,
        pular: folha ? Number(pular) || 0 : 0,
      }),
      700,
      600,
    );
  }

  return (
    <Dialog open={!!produto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Imprimir etiquetas</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{produto?.descricao}</p>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="et-copias">Quantidade</Label>
              <Input
                id="et-copias"
                type="number"
                min={1}
                max={500}
                value={copias}
                onChange={(e) => setCopias(e.target.value)}
              />
            </div>
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
            {folha
              ? "Na janela de impressão, use papel A4, escala 100% e sem margens."
              : `Na janela de impressão, escolha a impressora térmica com o papel em ${modelo.larguraMm} × ${modelo.alturaMm} mm, escala 100% e sem margens.`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={imprimir}>
            <Printer className="mr-2 size-4" /> Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
