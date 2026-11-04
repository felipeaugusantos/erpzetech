import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { useModulosCnae } from "@/lib/cnae";
import {
  GRAVIDADES,
  ROTULO_SITUACAO_FILA,
  podeTransicionar,
  posicaoNaFila,
  rotuloGravidade,
  type EntradaFila,
  type GravidadeTriagem,
  type SituacaoFila,
} from "@/lib/fila-atendimento";
import { timeBR } from "@/lib/format";
import { ESPECIES, rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/clinica-fila")({
  head: () => ({
    meta: [
      { title: "Fila do dia — EZRA ERP" },
      {
        name: "description",
        content:
          "Recepção da clínica: quem chegou, gravidade da triagem e ordem de atendimento do dia.",
      },
    ],
  }),
  component: FilaModulo,
});

function FilaModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Fila />;
}

type Entrada = EntradaFila & {
  queixa: string | null;
  observacoes: string | null;
  agendamento_id: string | null;
  pet: { id: string; nome: string; especie: string; raca: string | null; alergias: string | null };
  tutor: string;
  profissional: string | null;
};

type Consulta = {
  agendamento_id: string;
  inicio: string;
  situacao: string;
  pet: { id: string; nome: string; especie: string };
  tutor: string;
  profissional: string;
};

type Resposta = { dia: string; fila: Entrada[]; consultas: Consulta[] };

type Paciente = { id: string; nome: string; especie: string; raca: string | null; tutor: string };

function Fila() {
  const qc = useQueryClient();
  const [entrada, setEntrada] = useState<{
    pet_id: string;
    agendamento_id?: string;
    titulo: string;
  } | null>(null);
  const [gravidade, setGravidade] = useState<GravidadeTriagem>("comum");
  const [queixa, setQueixa] = useState("");
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const { data: sessao } = useSessionData();
  // o veterinário acompanha a fila e chama o próximo; registrar entrada e triagem é da recepção
  const souVeterinario =
    (sessao?.roles ?? []).includes("veterinario") &&
    !(sessao?.roles ?? []).some((r) =>
      ["administrador", "gestor", "vendedor", "caixa"].includes(r),
    );

  const { data, isLoading, error } = useQuery({
    queryKey: ["clinica-fila"],
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_fila_listar", {});
      if (error) throw error;
      return data as unknown as Resposta;
    },
  });

  const achados = useQuery({
    queryKey: ["clinica-fila-busca", termo],
    enabled: termo.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_fila_buscar_paciente", {
        p_busca: termo,
      });
      if (error) throw error;
      return (data ?? []) as unknown as Paciente[];
    },
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["clinica-fila"] });

  const darEntrada = useMutation({
    mutationFn: async () => {
      if (!entrada) return;
      const { error } = await supabase.rpc("clinica_fila_entrada", {
        p_dados: {
          pet_id: entrada.pet_id,
          ...(entrada.agendamento_id ? { agendamento_id: entrada.agendamento_id } : {}),
          gravidade,
          queixa,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entrada registrada na fila");
      setEntrada(null);
      setGravidade("comum");
      setQueixa("");
      refresh();
    },
    onError: (e: Error) => toast.error("Não foi possível dar entrada", { description: e.message }),
  });

  const mudar = useMutation({
    mutationFn: async (p: { id: string; para: SituacaoFila }) => {
      const { error } = await supabase.rpc("clinica_fila_situacao", {
        p_id: p.id,
        p_para: p.para,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const novaGravidade = useMutation({
    mutationFn: async (p: { id: string; g: GravidadeTriagem }) => {
      const { error } = await supabase.rpc("clinica_fila_gravidade", {
        p_id: p.id,
        p_gravidade: p.g,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const fila = data?.fila ?? [];
  const consultas = data?.consultas ?? [];
  const aguardando = fila.filter((f) => f.situacao === "aguardando").length;

  return (
    <div>
      <PageHeader
        title="Fila do dia"
        description="Quem chegou na clínica hoje, na ordem de atendimento: emergência, urgente e comum, cada grupo por ordem de chegada. O prontuário continua sendo aberto pelo veterinário."
      />

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : error ? (
        <EmptyState title="Não foi possível carregar" description={(error as Error).message} />
      ) : (
        <>
          {fila.length === 0 ? (
            <EmptyState
              title="Ninguém na recepção"
              description="Dê entrada pelas consultas de hoje abaixo ou pela chegada sem marcação."
            />
          ) : (
            <div className="panel mb-6 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Pet</TableHead>
                    <TableHead>Triagem</TableHead>
                    <TableHead>Chegada</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fila.map((f) => {
                    const g = GRAVIDADES.find((x) => x.value === f.gravidade);
                    const pos = posicaoNaFila(fila, f.id);
                    return (
                      <TableRow key={f.id}>
                        <TableCell className="font-medium">
                          {f.situacao === "aguardando" ? `${pos}º` : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{f.pet.nome}</div>
                          <div className="text-xs text-muted-foreground">
                            {rotulo(ESPECIES, f.pet.especie)} · tutor(a) {f.tutor}
                            {f.profissional ? ` · ${f.profissional}` : ""}
                          </div>
                          {f.pet.alergias && (
                            <div className="text-xs text-amber-800">Alergia: {f.pet.alergias}</div>
                          )}
                          {f.queixa && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              Queixa: {f.queixa}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {f.situacao === "aguardando" && !souVeterinario ? (
                            <Select
                              value={f.gravidade}
                              onValueChange={(v) =>
                                novaGravidade.mutate({ id: f.id, g: v as GravidadeTriagem })
                              }
                            >
                              <SelectTrigger className="w-36">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {GRAVIDADES.map((x) => (
                                  <SelectItem key={x.value} value={x.value}>
                                    {x.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge
                              variant={
                                g?.classe === "warning" ? "default" : (g?.classe ?? "secondary")
                              }
                            >
                              {rotuloGravidade(f.gravidade)}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>{timeBR(f.chegada_em)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={f.situacao === "em_atendimento" ? "default" : "secondary"}
                          >
                            {ROTULO_SITUACAO_FILA[f.situacao]}
                          </Badge>
                          {f.situacao === "em_atendimento" &&
                            f.agendamento_id &&
                            souVeterinario && (
                              <div className="mt-1">
                                <Button asChild size="sm" variant="outline">
                                  <Link
                                    to="/clinica-atendimento"
                                    search={{ agendamento: f.agendamento_id }}
                                  >
                                    Abrir atendimento
                                  </Link>
                                </Button>
                              </div>
                            )}
                        </TableCell>
                        <TableCell className="space-x-2 text-right">
                          {podeTransicionar(f.situacao, "em_atendimento") && (
                            <Button
                              size="sm"
                              disabled={mudar.isPending}
                              onClick={() => mudar.mutate({ id: f.id, para: "em_atendimento" })}
                            >
                              Chamar
                            </Button>
                          )}
                          {podeTransicionar(f.situacao, "atendido") && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={mudar.isPending}
                              onClick={() => mudar.mutate({ id: f.id, para: "atendido" })}
                            >
                              Atendido
                            </Button>
                          )}
                          {podeTransicionar(f.situacao, "aguardando") && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={mudar.isPending}
                              onClick={() => mudar.mutate({ id: f.id, para: "aguardando" })}
                            >
                              Devolver
                            </Button>
                          )}
                          {!souVeterinario && podeTransicionar(f.situacao, "desistiu") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={mudar.isPending}
                              onClick={() => mudar.mutate({ id: f.id, para: "desistiu" })}
                            >
                              Desistiu
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {!souVeterinario && (
            <>
              <h2 className="mb-2 text-sm font-semibold">
                Consultas de hoje ainda sem entrada{" "}
                <span className="font-normal text-muted-foreground">
                  ({consultas.length} · {aguardando} aguardando na fila)
                </span>
              </h2>
              {consultas.length === 0 ? (
                <p className="mb-6 text-sm text-muted-foreground">
                  Nenhuma consulta marcada para hoje fora da fila.
                </p>
              ) : (
                <div className="panel mb-6 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Horário</TableHead>
                        <TableHead>Pet</TableHead>
                        <TableHead>Veterinário(a)</TableHead>
                        <TableHead className="text-right">Ação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {consultas.map((c) => (
                        <TableRow key={c.agendamento_id}>
                          <TableCell>{timeBR(c.inicio)}</TableCell>
                          <TableCell>
                            <div className="font-medium">{c.pet.nome}</div>
                            <div className="text-xs text-muted-foreground">
                              {rotulo(ESPECIES, c.pet.especie)} · tutor(a) {c.tutor}
                            </div>
                          </TableCell>
                          <TableCell>{c.profissional}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setEntrada({
                                  pet_id: c.pet.id,
                                  agendamento_id: c.agendamento_id,
                                  titulo: `${c.pet.nome} (${timeBR(c.inicio)})`,
                                })
                              }
                            >
                              Dar entrada
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <h2 className="mb-2 text-sm font-semibold">Chegada sem consulta marcada</h2>
              <form
                className="mb-2 flex max-w-xl gap-2"
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
                          onClick={() => setEntrada({ pet_id: p.id, titulo: p.nome })}
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
            </>
          )}
        </>
      )}

      <Dialog
        open={Boolean(entrada)}
        onOpenChange={(o) => {
          if (!o) {
            setEntrada(null);
            setGravidade("comum");
            setQueixa("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-4" /> Entrada na fila — {entrada?.titulo}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="fila-gravidade">Gravidade (triagem)</Label>
              <Select value={gravidade} onValueChange={(v) => setGravidade(v as GravidadeTriagem)}>
                <SelectTrigger id="fila-gravidade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRAVIDADES.map((x) => (
                    <SelectItem key={x.value} value={x.value}>
                      {x.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="fila-queixa">Queixa rápida (opcional)</Label>
              <Input
                id="fila-queixa"
                maxLength={300}
                placeholder="Ex.: vomitando desde ontem"
                value={queixa}
                onChange={(e) => setQueixa(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntrada(null)}>
              Voltar
            </Button>
            <Button disabled={darEntrada.isPending} onClick={() => darEntrada.mutate()}>
              Confirmar entrada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
