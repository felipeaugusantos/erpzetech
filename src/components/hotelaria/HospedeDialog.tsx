import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { MEIOS_TRANSPORTE, MOTIVOS_VIAGEM, TIPOS_DOCUMENTO, erroDocumento } from "@/lib/hotelaria";
import { hsRpc } from "@/lib/hotelaria-api";
import type { HsHospede } from "@/lib/hotelaria-tipos";

const NENHUM = "__nenhum";

type Form = {
  nome: string;
  documento_tipo: string;
  documento_numero: string;
  nacionalidade: string;
  data_nascimento: string;
  sexo: string;
  profissao: string;
  telefone: string;
  email: string;
  cidade_residencia: string;
  estado_residencia: string;
  pais_residencia: string;
  procedencia: string;
  destino: string;
  motivo_viagem: string;
  meio_transporte: string;
  observacoes: string;
};

const vazio: Form = {
  nome: "",
  documento_tipo: NENHUM,
  documento_numero: "",
  nacionalidade: "Brasileira",
  data_nascimento: "",
  sexo: NENHUM,
  profissao: "",
  telefone: "",
  email: "",
  cidade_residencia: "",
  estado_residencia: "",
  pais_residencia: "Brasil",
  procedencia: "",
  destino: "",
  motivo_viagem: NENHUM,
  meio_transporte: NENHUM,
  observacoes: "",
};

const doForm = (h: HsHospede): Form => ({
  nome: h.nome,
  documento_tipo: h.documento_tipo ?? NENHUM,
  documento_numero: h.documento_numero ?? "",
  nacionalidade: h.nacionalidade,
  data_nascimento: h.data_nascimento ?? "",
  sexo: h.sexo ?? NENHUM,
  profissao: h.profissao ?? "",
  telefone: h.telefone ?? "",
  email: h.email ?? "",
  cidade_residencia: h.cidade_residencia ?? "",
  estado_residencia: h.estado_residencia ?? "",
  pais_residencia: h.pais_residencia,
  procedencia: h.procedencia ?? "",
  destino: h.destino ?? "",
  motivo_viagem: h.motivo_viagem ?? NENHUM,
  meio_transporte: h.meio_transporte ?? NENHUM,
  observacoes: h.observacoes ?? "",
});

const semNenhum = (v: string) => (v === NENHUM ? "" : v);

function Campo({
  id,
  rotulo,
  children,
  className,
}: {
  id: string;
  rotulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1 block text-xs">
        {rotulo}
      </Label>
      {children}
    </div>
  );
}

function Escolha({
  id,
  valor,
  aoMudar,
  opcoes,
}: {
  id: string;
  valor: string;
  aoMudar: (v: string) => void;
  opcoes: readonly { value: string; label: string }[];
}) {
  return (
    <Select value={valor} onValueChange={aoMudar}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NENHUM}>—</SelectItem>
        {opcoes.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Cadastro do hóspede com os campos da ficha nacional (FNRH). Só o nome é obrigatório; o documento vale para o check-in. */
export function HospedeDialog({
  aberto,
  onFechar,
  hospede,
  aoSalvar,
}: {
  aberto: boolean;
  onFechar: () => void;
  hospede?: HsHospede | null;
  aoSalvar?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(vazio);

  useEffect(() => {
    if (aberto) setForm(hospede ? doForm(hospede) : vazio);
  }, [aberto, hospede]);

  const mudar = (campo: keyof Form) => (v: string) => setForm((f) => ({ ...f, [campo]: v }));
  const digitado =
    (campo: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      mudar(campo)(e.target.value);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do hóspede.");
      const tipo = semNenhum(form.documento_tipo);
      const aviso = erroDocumento(tipo || null, form.documento_numero);
      if (aviso) throw new Error(aviso);
      return hsRpc<string>("hs_hospede_salvar", {
        p_dados: {
          ...(hospede
            ? { id: hospede.id, ativo: hospede.ativo, cliente_id: hospede.cliente_id }
            : {}),
          nome: form.nome,
          documento_tipo: tipo,
          documento_numero: tipo ? form.documento_numero : "",
          nacionalidade: form.nacionalidade,
          data_nascimento: form.data_nascimento,
          sexo: semNenhum(form.sexo),
          profissao: form.profissao,
          telefone: form.telefone,
          email: form.email,
          cidade_residencia: form.cidade_residencia,
          estado_residencia: form.estado_residencia,
          pais_residencia: form.pais_residencia,
          procedencia: form.procedencia,
          destino: form.destino,
          motivo_viagem: semNenhum(form.motivo_viagem),
          meio_transporte: semNenhum(form.meio_transporte),
          observacoes: form.observacoes,
        },
      });
    },
    onSuccess: (id) => {
      toast.success(hospede ? "Hóspede atualizado." : "Hóspede cadastrado.");
      void qc.invalidateQueries({ queryKey: ["hotel-hospedes"] });
      aoSalvar?.(id);
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{hospede ? "Editar hóspede" : "Novo hóspede"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo id="h-nome" rotulo="Nome completo *" className="sm:col-span-2">
            <Input id="h-nome" value={form.nome} onChange={digitado("nome")} />
          </Campo>
          <Campo id="h-doc-tipo" rotulo="Documento">
            <Escolha
              id="h-doc-tipo"
              valor={form.documento_tipo}
              aoMudar={mudar("documento_tipo")}
              opcoes={TIPOS_DOCUMENTO}
            />
          </Campo>
          <Campo id="h-doc-num" rotulo="Número do documento">
            <Input
              id="h-doc-num"
              value={form.documento_numero}
              onChange={digitado("documento_numero")}
              disabled={form.documento_tipo === NENHUM}
            />
          </Campo>
          <Campo id="h-nasc" rotulo="Nascimento">
            <Input
              id="h-nasc"
              type="date"
              value={form.data_nascimento}
              onChange={digitado("data_nascimento")}
            />
          </Campo>
          <Campo id="h-sexo" rotulo="Sexo">
            <Escolha
              id="h-sexo"
              valor={form.sexo}
              aoMudar={mudar("sexo")}
              opcoes={[
                { value: "F", label: "Feminino" },
                { value: "M", label: "Masculino" },
                { value: "O", label: "Outro" },
              ]}
            />
          </Campo>
          <Campo id="h-nac" rotulo="Nacionalidade">
            <Input id="h-nac" value={form.nacionalidade} onChange={digitado("nacionalidade")} />
          </Campo>
          <Campo id="h-prof" rotulo="Profissão">
            <Input id="h-prof" value={form.profissao} onChange={digitado("profissao")} />
          </Campo>
          <Campo id="h-tel" rotulo="Telefone">
            <Input id="h-tel" value={form.telefone} onChange={digitado("telefone")} />
          </Campo>
          <Campo id="h-email" rotulo="E-mail">
            <Input id="h-email" type="email" value={form.email} onChange={digitado("email")} />
          </Campo>
          <Campo id="h-cidade" rotulo="Cidade onde mora">
            <Input
              id="h-cidade"
              value={form.cidade_residencia}
              onChange={digitado("cidade_residencia")}
            />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo id="h-uf" rotulo="UF">
              <Input
                id="h-uf"
                maxLength={2}
                value={form.estado_residencia}
                onChange={digitado("estado_residencia")}
              />
            </Campo>
            <Campo id="h-pais" rotulo="País">
              <Input
                id="h-pais"
                value={form.pais_residencia}
                onChange={digitado("pais_residencia")}
              />
            </Campo>
          </div>
          <Campo id="h-proc" rotulo="Procedência (de onde vem)">
            <Input id="h-proc" value={form.procedencia} onChange={digitado("procedencia")} />
          </Campo>
          <Campo id="h-dest" rotulo="Destino (para onde vai)">
            <Input id="h-dest" value={form.destino} onChange={digitado("destino")} />
          </Campo>
          <Campo id="h-motivo" rotulo="Motivo da viagem">
            <Escolha
              id="h-motivo"
              valor={form.motivo_viagem}
              aoMudar={mudar("motivo_viagem")}
              opcoes={MOTIVOS_VIAGEM}
            />
          </Campo>
          <Campo id="h-transp" rotulo="Meio de transporte">
            <Escolha
              id="h-transp"
              valor={form.meio_transporte}
              aoMudar={mudar("meio_transporte")}
              opcoes={MEIOS_TRANSPORTE}
            />
          </Campo>
          <Campo id="h-obs" rotulo="Observações" className="sm:col-span-2">
            <Textarea
              id="h-obs"
              rows={2}
              value={form.observacoes}
              onChange={digitado("observacoes")}
            />
          </Campo>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            {salvar.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
