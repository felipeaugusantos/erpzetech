import { useEffect, useState } from "react";

import { TAMANHOS_CHINELO, gradeEntrada, type GradeEntrada } from "@/lib/personalizacao";
import { num } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Pede quantas tiras de cada tamanho estão entrando; a soma tem que bater com a quantidade da nota. */
export function GradeEntradaDialog({
  aberto,
  descricao,
  quantidade,
  inicial,
  onFechar,
  onSalvar,
  titulo = "Grade das tiras",
  texto = "informe quantas tiras de cada tamanho estão entrando.",
  salvando = false,
}: {
  titulo?: string;
  texto?: string;
  salvando?: boolean;
  aberto: boolean;
  descricao: string;
  quantidade: number;
  inicial: GradeEntrada;
  onFechar: () => void;
  onSalvar: (g: GradeEntrada) => void;
}) {
  const [qtds, setQtds] = useState<Record<string, string>>({});
  useEffect(() => {
    if (aberto) setQtds(Object.fromEntries(inicial.map((l) => [l.tamanho, String(l.quantidade)])));
  }, [aberto, inicial]);

  const grade = gradeEntrada(qtds);
  const soma = grade.reduce((s, l) => s + l.quantidade, 0);
  const falta = quantidade - soma;

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg">
        <DialogHeader className="min-w-0">
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            {descricao} — {texto}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {TAMANHOS_CHINELO.map((t) => (
            <div key={t} className="space-y-1">
              <Label htmlFor={`grade-${t}`}>{t}</Label>
              <Input
                id={`grade-${t}`}
                inputMode="numeric"
                value={qtds[t] ?? ""}
                onChange={(e) => setQtds((q) => ({ ...q, [t]: e.target.value.replace(/\D/g, "") }))}
              />
            </div>
          ))}
        </div>
        <p className={falta === 0 ? "text-sm text-primary" : "text-sm text-destructive"}>
          Informado {num(soma)} de {num(quantidade)}
          {falta > 0
            ? ` — faltam ${num(falta)}`
            : falta < 0
              ? ` — passou ${num(-falta)}`
              : " — confere com o total"}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={falta !== 0 || salvando} onClick={() => onSalvar(grade)}>
            Salvar grade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
