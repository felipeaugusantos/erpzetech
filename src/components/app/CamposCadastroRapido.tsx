import { Input } from "@/components/ui/input";
import { ClienteCombobox } from "@/components/app/ClienteCombobox";
import { DadosCadastroTutor } from "@/components/app/DadosCadastroTutor";
import { dadosTutorVazios } from "@/lib/tutor-novo";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ESPECIES_CADASTRO, type FormCadastroRapido } from "@/lib/cadastro-rapido";
import type { TutorDaCopia } from "@/lib/visita";

/** Campos do cadastro rápido de tutor e pet, iguais no cofre sem internet e no prontuário. */
export function CamposCadastroRapido({
  form,
  mexe,
  tutores,
  semCopia = false,
}: {
  form: FormCadastroRapido;
  mexe: (parte: Partial<FormCadastroRapido>) => void;
  /** Tutores que já existem e podem ser escolhidos (vazio: só tutor novo). */
  tutores: TutorDaCopia[];
  /** Mostra o aviso de que, para escolher tutor existente, é preciso preparar a visita. */
  semCopia?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="sm:col-span-3 border-b border-border pb-3">
        <h3 className="mb-3 font-semibold">Cadastro do tutor</h3>
        <Label htmlFor="cr-tutor">Tutor</Label>
        <ClienteCombobox clientes={tutores} value={form.tutorId} onChange={(id) => mexe({ tutorId: id })}
          balcaoValue="" balcaoLabel="Cadastrar tutor novo" placeholder="Buscar tutor já cadastrado…" />
        {semCopia && (
          <p className="mt-1 text-xs text-muted-foreground">
            Para escolher um tutor que já existe, prepare a visita antes (a agenda baixada traz os
            tutores).
          </p>
        )}
      </div>
      {!form.tutorId && (
        <>
          <div>
            <Label htmlFor="cr-tipo">Tipo</Label>
            <Select value={form.tutorTipo ?? "PF"} onValueChange={(v) => mexe({ tutorTipo: v as "PF" | "PJ", tutorDados: { ...(form.tutorDados ?? dadosTutorVazios), documento: "" } })}>
              <SelectTrigger id="cr-tipo"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="PF">Pessoa física</SelectItem><SelectItem value="PJ">Pessoa jurídica</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="cr-tnome">Nome do tutor</Label>
            <Input
              id="cr-tnome"
              value={form.tutorNome}
              onChange={(e) => mexe({ tutorNome: e.target.value })}
            />
          </div>
          <div className="sm:col-span-3">
            <DadosCadastroTutor dados={form.tutorDados ?? dadosTutorVazios} telefone={form.tutorTelefone}
              onChange={(tutorDados) => mexe({ tutorDados })} onTelefone={(tutorTelefone) => mexe({ tutorTelefone })} />
            <div className="mt-3 flex items-center gap-2">
              <Switch id="cr-mensagens" checked={form.tutorAceitaMensagens ?? true} onCheckedChange={(tutorAceitaMensagens) => mexe({ tutorAceitaMensagens })} />
              <Label htmlFor="cr-mensagens" className="text-sm">Pode receber mensagens (aniversário, retorno, vacina e agendamento)</Label>
            </div>
          </div>
        </>
      )}

      <div className="sm:col-span-2">
        <h3 className="mb-3 font-semibold">Cadastro do paciente</h3>
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
          <SelectTrigger id="cr-sexo" className={!form.sexo ? "border-warning bg-warning/10 text-warning" : ""}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__nd">Não cadastrado</SelectItem>
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
          <SelectTrigger id="cr-cast" className={!form.castrado ? "border-warning bg-warning/10 text-warning" : ""}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__nd">Não cadastrado</SelectItem>
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
  );
}
