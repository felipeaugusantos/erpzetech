import { useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Cofre } from "@/lib/cofre";
import { PREFIXO_PACIENTE } from "@/lib/atendimento-offline";
import {
  ESPECIES_CADASTRO,
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

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <Label htmlFor="cr-tutor">Tutor</Label>
          <Select
            value={form.tutorId || "__novo"}
            onValueChange={(v) => mexe({ tutorId: v === "__novo" ? "" : v })}
          >
            <SelectTrigger id="cr-tutor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__novo">Tutor novo</SelectItem>
              {tutores.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.nome}
                  {t.telefone ? ` · ${t.telefone}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!copia && (
            <p className="mt-1 text-xs text-muted-foreground">
              Para escolher um tutor que já existe, prepare a visita antes (a agenda baixada traz os
              tutores).
            </p>
          )}
        </div>
        {!form.tutorId && (
          <>
            <div className="sm:col-span-2">
              <Label htmlFor="cr-tnome">Nome do tutor</Label>
              <Input
                id="cr-tnome"
                value={form.tutorNome}
                onChange={(e) => mexe({ tutorNome: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cr-tfone">Telefone (com DDD)</Label>
              <Input
                id="cr-tfone"
                inputMode="tel"
                value={form.tutorTelefone}
                onChange={(e) => mexe({ tutorTelefone: e.target.value })}
              />
            </div>
          </>
        )}

        <div className="sm:col-span-2">
          <Label htmlFor="cr-pet">Nome do pet</Label>
          <Input
            id="cr-pet"
            value={form.petNome}
            onChange={(e) => mexe({ petNome: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="cr-esp">Espécie</Label>
          <Select
            value={form.especie}
            onValueChange={(v) => mexe({ especie: v as FormCadastroRapido["especie"] })}
          >
            <SelectTrigger id="cr-esp">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ESPECIES_CADASTRO.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="cr-raca">Raça</Label>
          <Input id="cr-raca" value={form.raca} onChange={(e) => mexe({ raca: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="cr-sexo">Sexo</Label>
          <Select
            value={form.sexo || "__nd"}
            onValueChange={(v) => mexe({ sexo: v === "__nd" ? "" : (v as "macho" | "femea") })}
          >
            <SelectTrigger id="cr-sexo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__nd">Não informado</SelectItem>
              <SelectItem value="macho">Macho</SelectItem>
              <SelectItem value="femea">Fêmea</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="cr-cast">Castrado</Label>
          <Select
            value={form.castrado || "__nd"}
            onValueChange={(v) => mexe({ castrado: v === "__nd" ? "" : (v as "sim" | "nao") })}
          >
            <SelectTrigger id="cr-cast">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__nd">Não informado</SelectItem>
              <SelectItem value="sim">Sim</SelectItem>
              <SelectItem value="nao">Não</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="cr-nasc">Nascimento</Label>
          <Input
            id="cr-nasc"
            type="date"
            value={form.nascimento}
            onChange={(e) => mexe({ nascimento: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="cr-peso">Peso (kg)</Label>
          <Input
            id="cr-peso"
            inputMode="decimal"
            value={form.peso}
            onChange={(e) => mexe({ peso: e.target.value })}
          />
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="cr-alerg">Alergias</Label>
          <Textarea
            id="cr-alerg"
            rows={2}
            value={form.alergias}
            onChange={(e) => mexe({ alergias: e.target.value })}
          />
        </div>
      </div>

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
