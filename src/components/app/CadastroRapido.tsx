import { useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CamposCadastroRapido } from "@/components/app/CamposCadastroRapido";
import type { Cofre } from "@/lib/cofre";
import { PREFIXO_PACIENTE } from "@/lib/atendimento-offline";
import {
  cadastroVazio,
  erroDoCadastroRapido,
  operacaoDoCadastroRapido,
  pacientesLocais,
  type FormCadastroRapido,
} from "@/lib/cadastro-rapido";
import { tutoresDaCopia, type CopiaVisita } from "@/lib/visita";

/**
 * Cadastro rápido de tutor e pet (cão ou gato) para a visita. Vale com ou sem internet: a gravação entra na fila do cofre, com os
 * identificadores já definidos aqui, e sai quando houver sinal. O pet novo já fica disponível para o atendimento antes de sincronizar.
 */
export function CadastroRapido({
  cofre,
  copia,
  online,
  aoGuardar,
}: {
  cofre: Cofre;
  copia: CopiaVisita | null;
  online: boolean;
  aoGuardar: () => Promise<void>;
}) {
  const [form, setForm] = useState<FormCadastroRapido>(cadastroVazio);
  const [guardando, setGuardando] = useState(false);
  const tutores = copia ? tutoresDaCopia(copia) : [];
  const erro = erroDoCadastroRapido(form);
  const mexe = (parte: Partial<FormCadastroRapido>) => setForm((f) => ({ ...f, ...parte }));

  async function guardar() {
    setGuardando(true);
    try {
      const existente = tutores.find((t) => t.id === form.tutorId);
      const op = operacaoDoCadastroRapido(form, existente?.nome);
      await cofre.gravar("fila", op.id, op);
      // o paciente novo segue disponível para atender mesmo depois que o cadastro for enviado e sair da fila
      const [novo] = pacientesLocais([op], Object.fromEntries(tutores.map((t) => [t.id, t.nome])));
      if (novo)
        await cofre.gravar("copia", PREFIXO_PACIENTE + novo.petId, {
          petId: novo.petId,
          petNome: novo.petNome,
          tutorNome: novo.tutorNome,
          especie: novo.especie,
          operacaoId: novo.operacaoId,
          guardadoEm: new Date().toISOString(),
        });
      // o próximo cadastro do mesmo tutor segue com ele escolhido
      setForm({
        ...cadastroVazio,
        tutorId: form.tutorId,
        tutorNome: form.tutorNome,
        tutorTelefone: form.tutorTelefone,
      });
      await aoGuardar();
      toast.success(
        online
          ? "Cadastro guardado: será enviado agora"
          : "Cadastro guardado no cofre: sai quando a internet voltar",
      );
    } catch (e) {
      toast.error("Não foi possível guardar", { description: (e as Error).message });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel grid gap-3 p-4">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <UserPlus className="size-5" /> Cadastro rápido de tutor e pet
      </h2>
      <p className="text-sm text-muted-foreground">
        Para cão ou gato que ainda não está no sistema. Fica guardado no cofre e é enviado quando
        houver internet. Se o telefone já existir em outro cadastro, a recepção recebe um aviso para
        conferir e unir; nada é apagado.
      </p>

      <CamposCadastroRapido form={form} mexe={mexe} tutores={tutores} semCopia={!copia} />

      {erro && (form.petNome || form.tutorNome) && (
        <p className="text-sm text-destructive">{erro}</p>
      )}
      <div>
        <Button onClick={() => void guardar()} disabled={guardando || !!erro}>
          <UserPlus className="size-4" /> {guardando ? "Guardando…" : "Guardar cadastro"}
        </Button>
      </div>
    </div>
  );
}
