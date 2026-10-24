import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { autorizarGestor } from "@/lib/frente-caixa.functions";

/**
 * Pede o e-mail e a senha de um gestor e devolve uma autorização de uso único (5 minutos) para o desconto.
 * `onAutorizado` recebe o id da autorização, que segue para o servidor junto com a operação.
 */
export function AutorizacaoGestor({
  aberto,
  motivo,
  onAutorizado,
  onCancelar,
}: {
  aberto: boolean;
  motivo: string;
  onAutorizado: (autorizacaoId: string) => void;
  onCancelar: () => void;
}) {
  const autorizar = useServerFn(autorizarGestor);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  useEffect(() => {
    if (aberto) {
      setEmail("");
      setSenha("");
    }
  }, [aberto]);

  const confirmar = useMutation({
    mutationFn: async () => autorizar({ data: { email, senha, acao: "desconto" } }),
    onSuccess: ({ autorizacaoId }) => onAutorizado(autorizacaoId),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onCancelar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Senha do gestor — desconto acima do limite</DialogTitle>
          <DialogDescription>{motivo}</DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="ag-email">E-mail do gestor</Label>
          <Input
            id="ag-email"
            className="mt-1"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="ag-senha">Senha</Label>
          <Input
            id="ag-senha"
            className="mt-1"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmar.mutate()}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button onClick={() => confirmar.mutate()} disabled={confirmar.isPending}>
            Autorizar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
