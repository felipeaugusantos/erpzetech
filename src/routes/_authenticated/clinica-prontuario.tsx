import { useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FlaskConical,
  PawPrint,
  Printer,
  Search,
  Stethoscope,
  Syringe,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { IniciarAtendimentoDialog } from "@/components/app/IniciarAtendimentoDialog";
import { NovoPacienteDialog } from "@/components/app/NovoPacienteDialog";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { DocumentosClinicos } from "@/components/app/DocumentosClinicos";
import { ListaFavoritosBulario } from "@/components/app/FavoritosBulario";
import { ResumoIaClinica } from "@/components/app/ResumoIaClinica";
import {
  evolucaoDoPeso,
  evolucaoDosSinais,
  type AtendimentoClinico,
  type PetClinico,
} from "@/lib/clinica";
import { dateBR, dateTimeBR, num } from "@/lib/format";
import { atendimentoAbertoDoPaciente } from "@/lib/iniciar-atendimento";
import { ESPECIES, PELAGENS, PORTES, idadeDoPet, rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/clinica-prontuario")({
  validateSearch: (search: Record<string, unknown>) => ({
    pet: typeof search["pet"] === "string" ? (search["pet"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Prontuário — EZRA ERP" },
      {
        name: "description",
        content: "Ficha do paciente e histórico de atendimentos da clínica.",
      },
      { property: "og:title", content: "Prontuário veterinário — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Ficha do paciente e histórico de atendimentos da clínica.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProntuarioModulo,
});

type Paciente = { id: string; nome: string; especie: string; raca: string | null; tutor: string };
type Ficha = {
  pet: PetClinico & { id: string; observacoes: string | null };
  tutor: string;
  atendimentos: AtendimentoClinico[];
};

function ProntuarioModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Prontuario />;
}

function Prontuario() {
  const { pet } = Route.useSearch();
  const navegar = useNavigate();
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [cadastrando, setCadastrando] = useState(false);
  const qc = useQueryClient();

  const achados = useQuery({
    queryKey: ["clinica-pacientes", termo],
    enabled: termo.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_pacientes", { p_busca: termo });
      if (error) throw error;
      return (data ?? []) as unknown as Paciente[];
    },
  });

  return (
    <div>
      <PageHeader
        title="Prontuário"
        description="Ficha e histórico do paciente. Só o veterinário vê o texto clínico; cada abertura de ficha fica registrada."
        actions={
          <Button variant="outline" onClick={() => setCadastrando(true)}>
            <UserPlus className="size-4" /> Cadastrar paciente
          </Button>
        }
      />
      {cadastrando && (
        <NovoPacienteDialog
          aoFechar={() => setCadastrando(false)}
          aoCadastrar={(petId) => {
            setCadastrando(false);
            void qc.invalidateQueries({ queryKey: ["clinica-pacientes"] });
            void navegar({ to: "/clinica-prontuario", search: { pet: petId } });
          }}
        />
      )}

      <form
        className="mb-4 flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTermo(busca.trim());
        }}
      >
        <Input
          aria-label="Buscar paciente"
          placeholder="Nome do pet ou do tutor"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={busca.trim().length < 2}>
          <Search className="size-4" /> Buscar
        </Button>
      </form>

      {termo && (
        <div className="mb-6">
          {achados.isLoading ? (
            <div className="panel h-16 animate-pulse" />
          ) : achados.error ? (
            <p className="text-sm text-destructive">{(achados.error as Error).message}</p>
          ) : (achados.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum paciente encontrado.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {achados.data?.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="panel p-3 text-left hover:bg-muted"
                  onClick={() => navegar({ to: "/clinica-prontuario", search: { pet: p.id } })}
                >
                  <span className="font-medium">{p.nome}</span>
                  <span className="block text-xs text-muted-foreground">
                    {rotulo(ESPECIES, p.especie)}
                    {p.raca ? ` · ${p.raca}` : ""} · tutor(a) {p.tutor}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {pet ? (
        <FichaDoPaciente key={pet} petId={pet} />
      ) : (
        !termo && (
          <EmptyState
            title="Escolha um paciente"
            description="Busque pelo nome do pet ou do tutor, ou abra o prontuário pela Minha agenda."
          />
        )
      )}
    </div>
  );
}

function FichaDoPaciente({ petId }: { petId: string }) {
  const qc = useQueryClient();
  const [alergias, setAlergias] = useState<string | null>(null);
  const [adendo, setAdendo] = useState<{ id: string; texto: string } | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const [pedidoSolicitacao, setPedidoSolicitacao] = useState(0);
  const navegar = useNavigate();

  const meuVeterinario = useQuery({
    queryKey: ["clinica-meu-veterinario"],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_meu_veterinario");
      if (error) throw error;
      return data as string;
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["clinica-historico", petId],
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_historico", { p_pet_id: petId });
      if (error) throw error;
      return data as unknown as Ficha;
    },
  });

  const salvarAlergias = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clinica_pet_alergias", {
        p_pet_id: petId,
        p_alergias: alergias ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Alergia atualizada");
      setAlergias(null);
      void qc.invalidateQueries({ queryKey: ["clinica-historico", petId] });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const criarAdendo = useMutation({
    mutationFn: async () => {
      if (!adendo) return;
      const { error } = await supabase.rpc("clinica_adendo_criar", {
        p_atendimento_id: adendo.id,
        p_texto: adendo.texto,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Adendo registrado");
      setAdendo(null);
      void qc.invalidateQueries({ queryKey: ["clinica-historico", petId] });
    },
    onError: (e: Error) => toast.error("Não foi possível registrar", { description: e.message }),
  });

  if (isLoading) return <div className="panel h-40 animate-pulse" />;
  if (error || !data)
    return (
      <EmptyState
        title="Não foi possível abrir a ficha"
        description={(error as Error | null)?.message ?? "Paciente não encontrado."}
      />
    );

  const p = data.pet;
  const evolucao = evolucaoDoPeso(data.atendimentos);
  const sinais = evolucaoDosSinais(data.atendimentos);
  const pesoAtual = evolucao.at(-1);
  const pesoAnterior = evolucao.at(-2);
  const variacao =
    pesoAtual && pesoAnterior ? Math.round((pesoAtual.peso - pesoAnterior.peso) * 100) / 100 : null;
  // continuar só vale para o atendimento aberto por este veterinário; o de outro não abre nem edita por aqui
  const aberto = atendimentoAbertoDoPaciente(
    data.atendimentos.filter(
      (a) => meuVeterinario.data && a.veterinario.id === meuVeterinario.data,
    ),
  );
  const abertoDeOutro =
    !aberto &&
    data.atendimentos.some(
      (a) => a.situacao === "aberto" && a.veterinario.id !== meuVeterinario.data,
    );

  return (
    <div className="grid gap-4">
      <div className="panel overflow-hidden">
        {p.alergias && (
          <div
            role="alert"
            className="flex items-center gap-2 bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground"
          >
            <TriangleAlert className="size-4 shrink-0" /> Alergia: {p.alergias}
          </div>
        )}
        <div className="flex flex-wrap items-start gap-4 p-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <PawPrint className="size-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-xl font-semibold">{p.nome}</h2>
              <span className="text-sm text-muted-foreground">Tutor(a) {data.tutor}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="secondary">{rotulo(ESPECIES, p.especie)}</Badge>
              {p.raca && <Badge variant="secondary">{p.raca}</Badge>}
              {p.nascimento && <Badge variant="secondary">{idadeDoPet(p.nascimento)}</Badge>}
              {p.porte && (
                <Badge variant="outline">Porte {rotulo(PORTES, p.porte).toLowerCase()}</Badge>
              )}
              {p.pelagem && (
                <Badge variant="outline">Pelo {rotulo(PELAGENS, p.pelagem).toLowerCase()}</Badge>
              )}
              {p.castrado !== null && (
                <Badge variant="outline">{p.castrado ? "Castrado" : "Não castrado"}</Badge>
              )}
            </div>
          </div>
          {pesoAtual && (
            <div className="rounded-lg border border-border px-3 py-2 text-right">
              <p className="text-xs text-muted-foreground">Último peso</p>
              <p className="font-display text-lg font-semibold">{num(pesoAtual.peso, 2)} kg</p>
              {variacao !== null && variacao !== 0 && (
                <p
                  className={`flex items-center justify-end gap-1 text-xs ${variacao > 0 ? "text-primary" : "text-destructive"}`}
                >
                  {variacao > 0 ? (
                    <TrendingUp className="size-3" />
                  ) : (
                    <TrendingDown className="size-3" />
                  )}
                  {variacao > 0 ? "+" : ""}
                  {num(variacao, 2)} kg desde a consulta anterior
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border bg-muted/40 px-4 py-3">
          {aberto ? (
            <Button asChild size="sm">
              <Link to="/clinica-atendimento" search={{ agendamento: aberto.agendamento_id }}>
                <Stethoscope /> Continuar atendimento
              </Link>
            </Button>
          ) : (
            <Button size="sm" onClick={() => setIniciando(true)}>
              <Stethoscope /> Iniciar atendimento
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <Link to="/clinica-vacinas" search={{ pet: petId, agendamento: undefined }}>
              <Syringe /> Vacinas e vermífugos
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link
              to="/clinica-exames"
              search={{ pet: petId, exame: undefined, atendimento: undefined }}
            >
              <FlaskConical /> Exames
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPedidoSolicitacao((n) => n + 1)}>
            <FilePlus2 /> Solicitar exames
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/clinica-ficha" search={{ pet: petId }}>
              <Printer /> Imprimir ficha
            </Link>
          </Button>
        </div>
        {abertoDeOutro && (
          <p className="px-4 pt-2 text-xs text-muted-foreground">
            Há atendimento aberto por outro(a) veterinário(a); só quem o abriu continua nele.
          </p>
        )}
        {iniciando && (
          <IniciarAtendimentoDialog
            petId={petId}
            petNome={p.nome}
            aoFechar={() => setIniciando(false)}
            aoIniciar={(agendamento) => {
              setIniciando(false);
              void qc.invalidateQueries({ queryKey: ["clinica-historico", petId] });
              void navegar({ to: "/clinica-atendimento", search: { agendamento } });
            }}
          />
        )}

        <div className="p-4">
          <Label htmlFor="f-alergia">Alergias</Label>
          <div className="flex gap-2">
            <Input
              id="f-alergia"
              value={alergias ?? p.alergias ?? ""}
              onChange={(e) => setAlergias(e.target.value)}
              placeholder="Nenhuma informada"
            />
            <Button
              variant="outline"
              disabled={alergias === null || salvarAlergias.isPending}
              onClick={() => salvarAlergias.mutate()}
            >
              Salvar
            </Button>
          </div>
          {p.alergias && (
            <p className="mt-1 text-xs text-muted-foreground">
              Esta alergia aparece na agenda de banho e tosa.
            </p>
          )}
          {evolucao.length > 1 && (
            <p className="mt-3 text-sm text-muted-foreground">
              Peso nas consultas: {evolucao.map((e) => `${num(e.peso, 1)} kg`).join(" → ")}
            </p>
          )}
        </div>
      </div>

      {sinais.length > 0 && (
        <div className="panel overflow-x-auto p-4">
          <h3 className="mb-2 font-display text-sm font-semibold">
            Sinais vitais nas consultas (mais recente primeiro)
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Consulta</th>
                <th className="py-1 pr-3 font-medium">Peso</th>
                <th className="py-1 pr-3 font-medium">Temperatura</th>
                <th className="py-1 pr-3 font-medium">Freq. cardíaca</th>
                <th className="py-1 font-medium">Freq. respiratória</th>
              </tr>
            </thead>
            <tbody>
              {sinais.map((v) => (
                <tr key={v.em} className="border-t border-border">
                  <td className="py-1 pr-3">{dateTimeBR(v.em)}</td>
                  <td className="py-1 pr-3">
                    {v.peso_kg !== null ? `${num(v.peso_kg, 2)} kg` : "—"}
                  </td>
                  <td className="py-1 pr-3">
                    {v.temperatura_c !== null ? `${num(v.temperatura_c, 1)} °C` : "—"}
                  </td>
                  <td className="py-1 pr-3">
                    {v.freq_cardiaca !== null ? `${v.freq_cardiaca} bpm` : "—"}
                  </td>
                  <td className="py-1">
                    {v.freq_respiratoria !== null ? `${v.freq_respiratoria} mpm` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DocumentosClinicos
        petId={petId}
        pet={{ nome: p.nome, especie: p.especie, raca: p.raca }}
        tutor={data.tutor}
        pedidoSolicitacao={pedidoSolicitacao}
      />

      <ResumoIaClinica petId={petId} souVeterinario={!!meuVeterinario.data} />

      <ListaFavoritosBulario titulo="Remédios favoritos da clínica" />

      <h3 className="font-display text-base font-semibold">Atendimentos</h3>
      {data.atendimentos.length === 0 ? (
        <EmptyState
          title="Sem atendimentos"
          description="O primeiro aparece aqui depois da consulta."
        />
      ) : (
        <ol className="relative ml-3 grid gap-4 border-l-2 border-border pl-6">
          {data.atendimentos.map((a) => (
            <li key={a.id} className="relative">
              <span
                aria-hidden
                className={`absolute -left-[33px] top-4 size-4 rounded-full border-2 border-background ${a.situacao === "fechado" ? "bg-muted-foreground" : "bg-primary"}`}
              />
              <div className="panel p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{dateTimeBR(a.aberto_em)}</strong>
                  <span className="text-muted-foreground">
                    {a.veterinario.nome} · CRMV {a.veterinario.crmv}/{a.veterinario.crmv_uf}
                  </span>
                  <Badge variant={a.situacao === "fechado" ? "secondary" : "default"}>
                    {a.situacao === "fechado" ? "Fechado" : "Em atendimento"}
                  </Badge>
                </div>
                <dl className="mt-2 grid gap-1">
                  <Linha rotulo="Queixa" valor={a.queixa} />
                  <Linha rotulo="Anamnese" valor={a.anamnese} />
                  <Linha
                    rotulo="Sinais"
                    valor={[
                      a.peso_kg ? `${num(Number(a.peso_kg), 2)} kg` : null,
                      a.temperatura_c ? `${num(Number(a.temperatura_c), 1)} °C` : null,
                      a.freq_cardiaca ? `${a.freq_cardiaca} bpm` : null,
                      a.freq_respiratoria ? `${a.freq_respiratoria} mpm` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  <Linha rotulo="Exame físico" valor={a.exame_fisico} />
                  <Linha rotulo="Diagnóstico" valor={a.diagnostico} />
                  <Linha rotulo="Conduta" valor={a.conduta} />
                  <Linha rotulo="Retorno" valor={a.retorno_em ? dateBR(a.retorno_em) : null} />
                  <Linha rotulo="Observações" valor={a.observacoes} />
                </dl>

                {a.adendos.map((d) => (
                  <div
                    key={d.id}
                    className="mt-3 rounded-md border-l-4 border-primary bg-muted/50 p-3"
                  >
                    <p className="whitespace-pre-wrap">{d.texto}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Adendo de {d.veterinario} (CRMV {d.crmv}/{d.crmv_uf}) em{" "}
                      {dateTimeBR(d.created_at)}
                    </p>
                  </div>
                ))}

                {a.situacao === "fechado" &&
                  (adendo?.id === a.id ? (
                    <div className="mt-3 grid gap-2">
                      <Textarea
                        aria-label="Texto do adendo"
                        rows={3}
                        value={adendo.texto}
                        onChange={(e) => setAdendo({ id: a.id, texto: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => criarAdendo.mutate()}
                          disabled={criarAdendo.isPending || !adendo.texto.trim()}
                        >
                          Registrar adendo
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setAdendo(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onClick={() => setAdendo({ id: a.id, texto: "" })}
                    >
                      Adicionar adendo
                    </Button>
                  ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Linha({ rotulo: r, valor }: { rotulo: string; valor: string | null | undefined }) {
  if (!valor) return null;
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8rem_1fr]">
      <dt className="text-muted-foreground">{r}</dt>
      <dd className="whitespace-pre-wrap">{valor}</dd>
    </div>
  );
}
