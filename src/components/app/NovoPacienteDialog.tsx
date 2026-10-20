import { useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import { CamposCadastroRapido } from "@/components/app/CamposCadastroRapido";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  cadastroVazio,
  erroDoCadastroRapido,
  operacaoDoCadastroRapido,
  type CadastroRapidoPayload,
  type FormCadastroRapido,
} from "@/lib/cadastro-rapido";
import { enviarOperacao } from "@/lib/fila-executores";
import { ehErroDeRede } from "@/lib/offline";

/**
 * Cadastro de tutor e pet (cão ou gato) pelo veterinário, para o paciente que chegou direto à clínica sem passar pela recepção.
 * Usa a mesma função idempotente do trabalho sem internet; aqui o envio é na hora e, sem sinal, a pessoa é mandada para o cofre.
 */
export function NovoPacienteDialog({
  aoCadastrar,
  aoFechar,
}: {
  /** Recebe o id do pet criado. */
  aoCadastrar: (petId: string) => void;
  aoFechar: () => void;
}) {
  const [form, setForm] = useState<FormCadastroRapido>(cadastroVazio);
  const [salvando, setSalvando] = useState(false);
  const erro = erroDoCadastroRapido(form);
  const mexe = (parte: Partial<FormCadastroRapido>) => setForm((f) => ({ ...f, ...parte }));

  async function cadastrar() {
    if (erro) return;
    setSalvando(true);
    try {
      const op = operacaoDoCadastroRapido(form);
      await enviarOperacao(op);
      const petId = String((op.payload as CadastroRapidoPayload).pet["id"]);
      toast.success(`${form.petNome.trim()} cadastrado`);
      aoCadastrar(petId);
    } catch (e) {
      const msg = (e as Error).message;
      if (ehErroDeRede(msg))
        toast.error("Sem internet", {
          description: "Use o cadastro rápido em Trabalho sem internet: ele guarda e envia depois.",
        });
      else toast.error("Não foi possível cadastrar", { description: msg });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5" /> Cadastrar paciente
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Para cão ou gato que chegou direto à clínica. Se o telefone do tutor já existir em outro
          cadastro, a recepção recebe um aviso para conferir e unir; nada é apagado.
        </p>
        <CamposCadastroRapido form={form} mexe={mexe} tutores={[]} />
        {erro && (form.petNome || form.tutorNome) && (
          <p className="text-sm text-destructive">{erro}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button onClick={() => void cadastrar()} disabled={salvando || !!erro}>
            {salvando ? "Cadastrando…" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
