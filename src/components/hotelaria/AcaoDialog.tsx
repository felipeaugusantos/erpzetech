import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formasPagamento } from "@/lib/financeiro";
import type { HsCaixa } from "@/lib/hotelaria-tipos";

/** Diálogo padrão das ações da estadia: título, campos, cancelar e confirmar. */
export function AcaoDialog({
  titulo,
  descricao,
  aberto,
  onFechar,
  rotulo,
  aoConfirmar,
  pendente = false,
  desabilitado = false,
  perigo = false,
  children,
}: {
  titulo: string;
  descricao?: string | undefined;
  aberto: boolean;
  onFechar: () => void;
  rotulo: string;
  aoConfirmar: () => void;
  pendente?: boolean;
  desabilitado?: boolean;
  perigo?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {descricao && <DialogDescription>{descricao}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button
            variant={perigo ? "destructive" : "default"}
            onClick={aoConfirmar}
            disabled={pendente || desabilitado}
          >
            {pendente ? "Aguarde…" : rotulo}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CampoRotulo({
  id,
  rotulo,
  children,
}: {
  id: string;
  rotulo: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id} className="mb-1 block text-xs">
        {rotulo}
      </Label>
      {children}
    </div>
  );
}

const FORMAS = formasPagamento.filter((f) => f.value !== "crediario");

/** Forma de pagamento e caixa aberto do hotel, para receber ou devolver dinheiro. */
export function CamposDeCaixa({
  caixas,
  caixaId,
  aoMudarCaixa,
  forma,
  aoMudarForma,
}: {
  caixas: HsCaixa[] | undefined;
  caixaId: string;
  aoMudarCaixa: (v: string) => void;
  forma: string;
  aoMudarForma: (v: string) => void;
}) {
  return (
    <>
      <CampoRotulo id="cx-forma" rotulo="Forma de pagamento">
        <Select value={forma} onValueChange={aoMudarForma}>
          <SelectTrigger id="cx-forma">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMAS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CampoRotulo>
      <CampoRotulo id="cx-caixa" rotulo="Caixa do hotel">
        {caixas && caixas.length > 0 ? (
          <Select value={caixaId} onValueChange={aoMudarCaixa}>
            <SelectTrigger id="cx-caixa">
              <SelectValue placeholder="Escolha o caixa" />
            </SelectTrigger>
            <SelectContent>
              {caixas.map((c, i) => (
                <SelectItem key={c.id} value={c.id}>
                  Caixa aberto {caixas.length > 1 ? i + 1 : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-destructive">
            Não há caixa aberto neste hotel. Abra o caixa para receber ou devolver dinheiro.
          </p>
        )}
      </CampoRotulo>
    </>
  );
}
