import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useModulosCnae } from "@/lib/cnae";
import {
  erroDosSinais,
  faltaParaFechar,
  formDoAtendimento,
  type AtendimentoClinico,
  type FormAtendimento,
} from "@/lib/clinica";
import { dateTimeBR } from "@/lib/format";
import { ESPECIES, PORTES, idadeDoPet, rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/clinica-atendimento")({
  validateSearch: (search: Record<string, unknown>) => ({
    agendamento:
      typeof search["agendamento"] === "string" ? (search["agendamento"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Atendimento clínico — ERP Ze Tech" },
      {
        name: "description",
        content: "Prontuário da consulta: queixa, exame, diagnóstico e conduta.",
      },
    ],
  }),
  component: AtendimentoModulo,
});

function AtendimentoModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Atendimento />;
}

function Atendimento() {
  const { agendamento } = Route.useSearch();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormAtendimento | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  // abrir é idempotente: devolve o atendimento que já existe para a consulta
  const { data, isLoading, error } = useQuery({
    queryKey: ["clinica-atendimento", agendamento],
    enabled: Boolean(agendamento),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_atendimento_abrir", {
        p_agendamento_id: agendamento as string,
      });
      if (error) throw error;
      return data as unknown as AtendimentoClinico;
    },
  });

  useEffect(() => {
    if (data && form === null) setForm(formDoAtendimento(data));
  }, [data, form]);

  function guardar(novo: AtendimentoClinico) {
    qc.setQueryData(["clinica-atendimento", agendamento], novo);
    void qc.invalidateQueries({ queryKey: ["pet-minha-agenda"] });
  }

  const salvar = useMutation({
    mutationFn: async () => {
      if (!data || !form) return null;
      const erro = erroDosSinais(form);
      if (erro) throw new Error(erro);
      const { data: r, error } = await supabase.rpc("clinica_atendimento_salvar", {
        p_id: data.id,
        p_dados: form as unknown as Json,
      });
      if (error) throw error;
      return r as unknown as AtendimentoClinico;
    },
    onSuccess: (r) => {
      if (!r) return;
      guardar(r);
      toast.success("Atendimento salvo");
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const fechar = useMutation({
    mutationFn: async () => {
      if (!data || !form) return null;
      const falta = faltaParaFechar(form);
      if (falta.length) throw new Error(`Preencha antes de fechar: ${falta.join(" e ")}.`);
      const erro = erroDosSinais(form);
      if (erro) throw new Error(erro);
      const salvo = await supabase.rpc("clinica_atendimento_salvar", {
        p_id: data.id,
        p_dados: form as unknown as Json,
      });
      if (salvo.error) throw salvo.error;
      const { data: r, error } = await supabase.rpc("clinica_atendimento_fechar", {
        p_id: data.id,
      });
      if (error) throw error;
      return r as unknown as AtendimentoClinico;
    },
    onSuccess: (r) => {
      if (!r) return;
      setConfirmando(false);
      guardar(r);
      toast.success("Atendimento fechado", {
        description: "A consulta foi para pronto; a recepção faz a cobrança.",
      });
    },
    onError: (e: Error) => {
      setConfirmando(false);
      toast.error("Não foi possível fechar", { description: e.message });
    },
  });

  if (!agendamento)
    return (
      <EmptyState
        title="Nenhuma consulta escolhida"
        description="Abra o prontuário pela Minha agenda, na consulta do dia."
        action={
          <Button asChild variant="outline">
            <Link to="/pet-minha-agenda">Ir para Minha agenda</Link>
          </Button>
        }
      />
    );
  if (isLoading || !form) {
    if (error)
      return (
        <EmptyState
          title="Não foi possível abrir o atendimento"
          description={(error as Error).message}
        />
      );
    return <div className="panel h-40 animate-pulse" />;
  }
  if (!data) return null;

  const fechado = data.situacao === "fechado";
  const campo = (k: keyof FormAtendimento) => ({
    value: form[k],
    disabled: fechado,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [k]: e.target.value }),
  });
  const p = data.pet;

  return (
    <div>
      <PageHeader
        title={`Atendimento de ${p.nome}`}
        description={`Tutor(a) ${data.tutor} · aberto em ${dateTimeBR(data.aberto_em)} por ${data.veterinario.nome} (CRMV ${data.veterinario.crmv}/${data.veterinario.crmv_uf})`}
        actions={
          <Badge variant={fechado ? "secondary" : "default"}>
            {fechado ? "Fechado" : "Em atendimento"}
          </Badge>
        }
      />

      <div className="panel mb-4 p-4 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>{rotulo(ESPECIES, p.especie)}</span>
          {p.raca && <span>{p.raca}</span>}
          {p.porte && <span>Porte {rotulo(PORTES, p.porte).toLowerCase()}</span>}
          {p.nascimento && <span>{idadeDoPet(p.nascimento)}</span>}
          {p.castrado !== null && <span>{p.castrado ? "Castrado" : "Não castrado"}</span>}
        </div>
        {p.alergias && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
            <TriangleAlert className="size-4 shrink-0" /> Alergia: {p.alergias}
          </div>
        )}
        <Link
          to="/clinica-prontuario"
          search={{ pet: data.pet_id }}
          className="mt-2 inline-block text-primary underline"
        >
          Ver o histórico do paciente
        </Link>
        <Link
          to="/clinica-exames"
          search={{
            pet: data.pet_id,
            exame: undefined,
            atendimento: data.situacao === "aberto" ? data.id : undefined,
          }}
          className="mt-2 ml-4 inline-block text-primary underline"
        >
          Exames do paciente
        </Link>
      </div>

      {fechado && (
        <div className="mb-4 flex items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm">
          <Lock className="size-4" /> Atendimento fechado em {dateTimeBR(data.fechado_em)}. Para
          complementar ou corrigir, registre um adendo no histórico do paciente.
        </div>
      )}

      <div className="panel grid gap-4 p-4">
        <div>
          <Label htmlFor="c-queixa">Queixa *</Label>
          <Textarea id="c-queixa" rows={2} {...campo("queixa")} />
        </div>
        <div>
          <Label htmlFor="c-anamnese">Anamnese</Label>
          <Textarea id="c-anamnese" rows={3} {...campo("anamnese")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <Label htmlFor="c-peso">Peso (kg)</Label>
            <Input id="c-peso" inputMode="decimal" {...campo("peso_kg")} />
          </div>
          <div>
            <Label htmlFor="c-temp">Temperatura (°C)</Label>
            <Input id="c-temp" inputMode="decimal" {...campo("temperatura_c")} />
          </div>
          <div>
            <Label htmlFor="c-fc">Freq. cardíaca (bpm)</Label>
            <Input id="c-fc" inputMode="numeric" {...campo("freq_cardiaca")} />
          </div>
          <div>
            <Label htmlFor="c-fr">Freq. respiratória (mpm)</Label>
            <Input id="c-fr" inputMode="numeric" {...campo("freq_respiratoria")} />
          </div>
        </div>
        <div>
          <Label htmlFor="c-exame">Exame físico</Label>
          <Textarea id="c-exame" rows={3} {...campo("exame_fisico")} />
        </div>
        <div>
          <Label htmlFor="c-diag">Diagnóstico</Label>
          <Textarea id="c-diag" rows={2} {...campo("diagnostico")} />
        </div>
        <div>
          <Label htmlFor="c-conduta">Conduta *</Label>
          <Textarea id="c-conduta" rows={3} {...campo("conduta")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <div>
            <Label htmlFor="c-retorno">Retorno sugerido</Label>
            <Input id="c-retorno" type="date" {...campo("retorno_em")} />
          </div>
          <div>
            <Label htmlFor="c-obs">Observações</Label>
            <Input id="c-obs" {...campo("observacoes")} />
          </div>
        </div>
      </div>

      {!fechado && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            Salvar
          </Button>
          <Button onClick={() => setConfirmando(true)} disabled={fechar.isPending}>
            Fechar atendimento
          </Button>
        </div>
      )}

      <Dialog open={confirmando} onOpenChange={(o) => !o && setConfirmando(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fechar o atendimento?</DialogTitle>
            <DialogDescription>
              Depois de fechado o texto não pode mais ser alterado: correções entram como adendo,
              com o seu nome e CRMV. A consulta vai para pronto e a recepção faz a cobrança.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmando(false)}>
              Voltar
            </Button>
            <Button onClick={() => fechar.mutate()} disabled={fechar.isPending}>
              Fechar atendimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
