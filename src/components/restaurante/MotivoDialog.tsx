import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Pede o motivo de um cancelamento. */
export function MotivoDialog({
  aberto,
  titulo,
  obrigatorio,
  carregando,
  onConfirmar,
  onFechar,
}: {
  aberto: boolean;
  titulo: string;
  obrigatorio: boolean;
  carregando?: boolean;
  onConfirmar: (motivo: string) => void;
  onFechar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const faltaMotivo = obrigatorio && !motivo.trim();
  const voltar = () => {
    setMotivo("");
    onFechar();
  };
  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => {
        if (!o) voltar();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        <div>
          <Label htmlFor="motivo">Motivo{obrigatorio ? "" : " (opcional)"}</Label>
          <Textarea id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={voltar}>
            Voltar
          </Button>
          <Button
            variant="destructive"
            disabled={faltaMotivo || carregando}
            onClick={() => {
              onConfirmar(motivo.trim());
              setMotivo("");
            }}
          >
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
