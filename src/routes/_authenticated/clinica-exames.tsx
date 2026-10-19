import { useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Lock, Plus, Printer, Search, TrendingUp } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import {
  SITUACOES_EXAME,
  TIPOS_EXAME,
  agruparCampos,
  avisoDiferencial,
  formatarNumero,
  rotuloFaixa,
  situacaoNaFaixa,
  valorDoResultado,
  valoresNumericos,
  variacao,
  type ExameClinico,
  type PontoEvolucao,
  type ResultadoExame,
  type ResumoExame,
} from "@/lib/exames";
import { dateBR, dateTimeBR } from "@/lib/format";
import { ESPECIES, idadeDoPet, rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/clinica-exames")({
  validateSearch: (search: Record<string, unknown>) => ({
    pet: typeof search["pet"] === "string" ? (search["pet"] as string) : undefined,
    exame: typeof search["exame"] === "string" ? (search["exame"] as string) : undefined,
    atendimento:
      typeof search["atendimento"] === "string" ? (search["atendimento"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Exames — ERP Ze Tech" },
      {
        name: "description",
        content: "Resultados de exames do paciente: hemograma, bioquímica, urina e outros.",
      },
    ],
  }),
  component: ExamesModulo,
});

type Paciente = { id: string; nome: string; especie: string; raca: string | null; tutor: string };
type Lista = {
  pet: {
    id: string;
    nome: string;
    especie: string;
    raca: string | null;
    sexo: string | null;
    nascimento: string | null;
  };
  tutor: string;
  exames: ResumoExame[];
};
type ModeloResumo = {
  id: string;
  nome: string;
  tipo: string;
  material: string | null;
  ativo: boolean;
};

function ExamesModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Exames />;
}

function Exames() {
  const { pet, exame, atendimento } = Route.useSearch();
  const navegar = useNavigate();
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");

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
        title="Exames"
        description="Resultados do paciente, preenchidos pelo veterinário. Campo em branco é “não feito”; exame fechado não muda (correção é adendo) e cada abertura fica registrada."
      />

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
                  onClick={() =>
                    navegar({
                      to: "/clinica-exames",
                      search: { pet: p.id, exame: undefined, atendimento: undefined },
                    })
                  }
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
        <ExamesDoPaciente petId={pet} exameId={exame} atendimentoId={atendimento} />
      ) : (
        !termo && (
          <EmptyState
            title="Escolha um paciente"
            description="Busque pelo nome do pet ou do tutor, ou abra os exames pelo atendimento."
          />
        )
      )}
    </div>
  );
}

function ExamesDoPaciente({
  petId,
  exameId,
  atendimentoId,
}: {
  petId: string;
  exameId: string | undefined;
  atendimentoId: string | undefined;
}) {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const [novoAberto, setNovoAberto] = useState(false);
  const [modeloId, setModeloId] = useState("");
  const [ligar, setLigar] = useState(true);
  const [laboratorio, setLaboratorio] = useState("");
  const [coleta, setColeta] = useState("");
  const [material, setMaterial] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["clinica-exames-pet", petId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exames_do_pet", { p_pet_id: petId });
      if (error) throw error;
      return data as unknown as Lista;
    },
  });

  const { data: modelos = [] } = useQuery({
    queryKey: ["clinica-exame-modelos-lista"],
    enabled: novoAberto,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exame_modelos");
      if (error) throw error;
      return ((data ?? []) as unknown as ModeloResumo[]).filter((m) => m.ativo);
    },
  });

  const abrir = useMutation({
    mutationFn: async () => {
      const dados: Record<string, string> = {};
      if (ligar && atendimentoId) dados["atendimento_id"] = atendimentoId;
      if (!(ligar && atendimentoId)) dados["laboratorio"] = laboratorio.trim();
      else if (laboratorio.trim()) dados["laboratorio"] = laboratorio.trim();
      if (coleta) dados["data_coleta"] = coleta;
      if (material.trim()) dados["material"] = material.trim();
      const { data, error } = await supabase.rpc("clinica_exame_abrir", {
        p_pet_id: petId,
        p_modelo_id: modeloId,
        p_dados: dados,
      });
      if (error) throw error;
      return data as unknown as ExameClinico;
    },
    onSuccess: (e) => {
      toast.success("Exame aberto");
      setNovoAberto(false);
      void qc.invalidateQueries({ queryKey: ["clinica-exames-pet", petId] });
      navegar({
        to: "/clinica-exames",
        search: { pet: petId, exame: e.id, atendimento: atendimentoId },
      });
    },
    onError: (e: Error) =>
      toast.error("Não foi possível abrir o exame", { description: e.message }),
  });

  if (isLoading) return <div className="panel h-40 animate-pulse" />;
  if (error || !data)
    return <p className="text-sm text-destructive">{(error as Error | null)?.message}</p>;

  const avulso = !(ligar && atendimentoId);

  return (
    <div className="grid gap-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="font-display text-lg font-semibold">{data.pet.nome}</h2>
          <p className="text-sm text-muted-foreground">
            {rotulo(ESPECIES, data.pet.especie)}
            {data.pet.raca ? ` · ${data.pet.raca}` : ""}
            {data.pet.nascimento ? ` · ${idadeDoPet(data.pet.nascimento)}` : ""} · tutor(a){" "}
            {data.tutor}
          </p>
          <Link
            to="/clinica-prontuario"
            search={{ pet: petId }}
            className="text-sm text-primary underline"
          >
            Ver o prontuário do paciente
          </Link>
        </div>
        <Button
          onClick={() => {
            setModeloId("");
            setLigar(true);
            setLaboratorio("");
            setColeta("");
            setMaterial("");
            setNovoAberto(true);
          }}
        >
          <Plus className="size-4" /> Novo exame
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="grid content-start gap-2">
          {data.exames.length === 0 ? (
            <EmptyState
              title="Sem exames"
              description="Abra um exame a partir de um modelo."
              className="py-8"
            />
          ) : (
            data.exames.map((x) => (
              <button
                key={x.id}
                type="button"
                className={`panel p-3 text-left hover:bg-muted ${x.id === exameId ? "ring-2 ring-primary" : ""}`}
                onClick={() =>
                  navegar({
                    to: "/clinica-exames",
                    search: { pet: petId, exame: x.id, atendimento: atendimentoId },
                  })
                }
              >
                <span className="font-medium">{x.nome}</span>
                <span className="block text-xs text-muted-foreground">
                  Coleta {dateBR(x.data_coleta)}
                  {x.laboratorio ? ` · ${x.laboratorio}` : ""}
                </span>
                <span className="mt-1 flex items-center gap-2 text-xs">
                  <Badge variant={x.situacao === "fechado" ? "default" : "outline"}>
                    {rotulo(SITUACOES_EXAME, x.situacao)}
                  </Badge>
                  {x.situacao !== "cancelado" && (
                    <span className="text-muted-foreground">
                      {x.preenchidos} de {x.total} preenchidos
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>

        <div>
          {exameId ? (
            <ExameAberto key={exameId} petId={petId} exameId={exameId} />
          ) : (
            <EmptyState
              title="Escolha um exame"
              description="Selecione um exame da lista ou abra um novo."
              className="py-10"
            />
          )}
        </div>
      </div>

      <Dialog open={novoAberto} onOpenChange={(o) => !o && setNovoAberto(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo exame</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="nx-modelo">Modelo</Label>
              <Select
                value={modeloId || "__nenhum"}
                onValueChange={(v) => setModeloId(v === "__nenhum" ? "" : v)}
              >
                <SelectTrigger id="nx-modelo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nenhum">Escolha o modelo</SelectItem>
                  {modelos.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome} · {rotulo(TIPOS_EXAME, m.tipo)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {modelos.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Sem modelos ativos: a gestão cria os modelos iniciais em Modelos de exame.
                </p>
              )}
            </div>
            {atendimentoId && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ligar}
                  onChange={(e) => setLigar(e.target.checked)}
                />
                Ligar ao atendimento aberto
              </label>
            )}
            <div>
              <Label htmlFor="nx-lab">
                Laboratório{avulso ? " (obrigatório no exame avulso)" : " (opcional)"}
              </Label>
              <Input
                id="nx-lab"
                value={laboratorio}
                onChange={(e) => setLaboratorio(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="nx-coleta">Data da coleta</Label>
                <Input
                  id="nx-coleta"
                  type="date"
                  value={coleta}
                  onChange={(e) => setColeta(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="nx-mat">Material</Label>
                <Input
                  id="nx-mat"
                  placeholder="Do modelo"
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovoAberto(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => abrir.mutate()}
              disabled={abrir.isPending || !modeloId || (avulso && !laboratorio.trim())}
            >
              Abrir exame
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Digitado = Record<string, { valor: string; nota: string; min: string; max: string }>;

const textoNum = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

function digitadoDe(e: ExameClinico): Digitado {
  return Object.fromEntries(
    e.resultados.map((r) => [
      r.id,
      {
        valor: r.forma === "numero" ? textoNum(r.valor_num) : (r.valor_texto ?? ""),
        nota: r.nota ?? "",
        min: textoNum(r.faixa_min),
        max: textoNum(r.faixa_max),
      },
    ]),
  );
}

function ExameAberto({ petId, exameId }: { petId: string; exameId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["clinica-exame", exameId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exame_get", { p_id: exameId });
      if (error) throw error;
      return data as unknown as ExameClinico;
    },
  });
  if (isLoading) return <div className="panel h-40 animate-pulse" />;
  if (error || !data)
    return <p className="text-sm text-destructive">{(error as Error | null)?.message}</p>;
  return (
    <Formulario
      key={`${data.id}-${data.situacao}-${data.adendos.length}`}
      petId={petId}
      exame={data}
    />
  );
}

function Formulario({ petId, exame }: { petId: string; exame: ExameClinico }) {
  const qc = useQueryClient();
  const aberto = exame.situacao === "aberto";
  const [dig, setDig] = useState<Digitado>(() => digitadoDe(exame));
  const [obs, setObs] = useState(exame.observacoes ?? "");
  const [material, setMaterial] = useState(exame.material ?? "");
  const [lab, setLab] = useState(exame.laboratorio ?? "");
  const [coleta, setColeta] = useState(exame.data_coleta);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [adendo, setAdendo] = useState("");
  const [laudo, setLaudo] = useState(false);
  const [evolucaoDe, setEvolucaoDe] = useState<ResultadoExame | null>(null);

  const valores = valoresNumericos(
    exame.resultados,
    Object.fromEntries(Object.entries(dig).map(([id, d]) => [id, d.valor])),
  );
  const aviso = aberto ? avisoDiferencial(exame.resultados, valores) : null;
  const grupos = agruparCampos(exame.resultados);

  const atualizar = (e: ExameClinico) => {
    qc.setQueryData(["clinica-exame", exame.id], e);
    void qc.invalidateQueries({ queryKey: ["clinica-exames-pet", petId] });
  };

  const payload = () => ({
    material,
    laboratorio: lab,
    data_coleta: coleta,
    observacoes: obs,
    resultados: exame.resultados.map((r) => {
      const d = dig[r.id];
      const faixa =
        r.forma === "numero" || r.forma === "calculado"
          ? { faixa_min: d?.min ?? "", faixa_max: d?.max ?? "" }
          : {};
      // o valor do campo calculado é do banco (total × percentual): a tela não o envia
      const valor = r.forma === "calculado" ? {} : { valor: d?.valor ?? "" };
      return { id: r.id, nota: d?.nota ?? "", ...valor, ...faixa };
    }),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exame_salvar", {
        p_id: exame.id,
        p_dados: payload(),
      });
      if (error) throw error;
      return data as unknown as ExameClinico;
    },
    onSuccess: (e) => {
      toast.success("Exame salvo");
      atualizar(e);
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const fechar = useMutation({
    mutationFn: async () => {
      const { error: e1 } = await supabase.rpc("clinica_exame_salvar", {
        p_id: exame.id,
        p_dados: payload(),
      });
      if (e1) throw e1;
      const { data, error } = await supabase.rpc("clinica_exame_fechar", { p_id: exame.id });
      if (error) throw error;
      return data as unknown as ExameClinico;
    },
    onSuccess: (e) => {
      toast.success("Exame fechado");
      atualizar(e);
    },
    onError: (e: Error) => toast.error("Não foi possível fechar", { description: e.message }),
  });

  const cancelar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exame_cancelar", {
        p_id: exame.id,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
      return data as unknown as ExameClinico;
    },
    onSuccess: (e) => {
      toast.success("Exame cancelado");
      setCancelando(false);
      atualizar(e);
    },
    onError: (e: Error) => toast.error("Não foi possível cancelar", { description: e.message }),
  });

  const criarAdendo = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exame_adendo_criar", {
        p_exame_id: exame.id,
        p_texto: adendo.trim(),
      });
      if (error) throw error;
      return data as unknown as ExameClinico;
    },
    onSuccess: (e) => {
      toast.success("Adendo registrado");
      setAdendo("");
      atualizar(e);
    },
    onError: (e: Error) => toast.error("Não foi possível registrar", { description: e.message }),
  });

  const mexe = (id: string, parte: Partial<Digitado[string]>) =>
    setDig((d) => ({
      ...d,
      [id]: { valor: "", nota: "", min: "", max: "", ...d[id], ...parte },
    }));

  const ocupado = salvar.isPending || fechar.isPending;

  return (
    <div className="grid gap-4">
      <div className="panel p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-lg font-semibold">{exame.nome}</h3>
          <Badge variant={exame.situacao === "fechado" ? "default" : "outline"}>
            {rotulo(SITUACOES_EXAME, exame.situacao)}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Aberto por {exame.veterinario.nome} (CRMV {exame.veterinario.crmv}-
          {exame.veterinario.crmv_uf}) em {dateTimeBR(exame.aberto_em)}
          {exame.atendimento_id ? " · ligado a um atendimento" : " · exame avulso"}
        </p>
        {aberto ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="ex-coleta">Data da coleta</Label>
              <Input
                id="ex-coleta"
                type="date"
                value={coleta}
                onChange={(e) => setColeta(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ex-mat">Material</Label>
              <Input id="ex-mat" value={material} onChange={(e) => setMaterial(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ex-lab">Laboratório{exame.atendimento_id ? " (opcional)" : ""}</Label>
              <Input id="ex-lab" value={lab} onChange={(e) => setLab(e.target.value)} />
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm">
            Coleta {dateBR(exame.data_coleta)}
            {exame.material ? ` · ${exame.material}` : ""}
            {exame.laboratorio ? ` · ${exame.laboratorio}` : ""}
          </p>
        )}
      </div>

      {exame.situacao === "fechado" && (
        <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm">
          <Lock className="size-4" /> Exame fechado em {dateTimeBR(exame.fechado_em)}. Para corrigir
          ou complementar, registre um adendo.
        </div>
      )}
      {exame.situacao === "cancelado" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Exame cancelado em {dateTimeBR(exame.cancelado_em)}: {exame.cancelado_motivo}
        </div>
      )}
      {aviso && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {aviso}
        </div>
      )}

      {grupos.map((g) => (
        <div key={g.grupo || "__geral"} className="panel overflow-x-auto">
          <div className="border-b px-4 py-2 text-sm font-medium">{g.grupo || "Geral"}</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campo</TableHead>
                <TableHead className="w-44">Resultado</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Referência</TableHead>
                <TableHead className="text-right">Evolução</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {g.campos.map((r) => {
                const d = dig[r.id];
                const numerico = r.forma === "numero" || r.forma === "calculado";
                const valor = valores[r.id] ?? null;
                const faixaMin = r.forma === "numero" ? parseFaixa(d?.min) : r.faixa_min;
                const faixaMax = r.forma === "numero" ? parseFaixa(d?.max) : r.faixa_max;
                const posicao = numerico ? situacaoNaFaixa(valor, faixaMin, faixaMax) : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.nome}
                      {r.nota && !aberto && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {r.nota}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {!aberto ? (
                        <span
                          className={
                            posicao && posicao !== "dentro" ? "font-semibold text-destructive" : ""
                          }
                        >
                          {valorDoResultado(r)}
                          {posicao === "abaixo" && " ↓"}
                          {posicao === "acima" && " ↑"}
                        </span>
                      ) : r.forma === "calculado" ? (
                        <span
                          className={
                            posicao && posicao !== "dentro" ? "font-semibold text-destructive" : ""
                          }
                        >
                          {valor === null ? "—" : formatarNumero(valor, r.casas)}
                          {posicao === "abaixo" && " ↓"}
                          {posicao === "acima" && " ↑"}
                        </span>
                      ) : r.forma === "escolha" ? (
                        <Select
                          value={d?.valor || "__branco"}
                          onValueChange={(v) => mexe(r.id, { valor: v === "__branco" ? "" : v })}
                        >
                          <SelectTrigger aria-label={r.nome}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__branco">Não feito</SelectItem>
                            {(r.opcoes ?? []).map((o) => (
                              <SelectItem key={o} value={o}>
                                {o}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          aria-label={r.nome}
                          inputMode={r.forma === "numero" ? "decimal" : "text"}
                          placeholder="Não feito"
                          className={posicao && posicao !== "dentro" ? "border-destructive" : ""}
                          value={d?.valor ?? ""}
                          onChange={(e) => mexe(r.id, { valor: e.target.value })}
                        />
                      )}
                      {aberto && posicao && posicao !== "dentro" && (
                        <span className="text-xs text-destructive">
                          {posicao === "abaixo" ? "abaixo da faixa" : "acima da faixa"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{numerico ? r.unidade || "—" : ""}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {numerico &&
                        (aberto && r.forma === "numero" ? (
                          <span className="flex items-center gap-1">
                            <Input
                              aria-label={`Mínimo — ${r.nome}`}
                              placeholder="mín."
                              inputMode="decimal"
                              className="h-8 w-16 px-2"
                              value={d?.min ?? ""}
                              onChange={(e) => mexe(r.id, { min: e.target.value })}
                            />
                            <span>a</span>
                            <Input
                              aria-label={`Máximo — ${r.nome}`}
                              placeholder="máx."
                              inputMode="decimal"
                              className="h-8 w-16 px-2"
                              value={d?.max ?? ""}
                              onChange={(e) => mexe(r.id, { max: e.target.value })}
                            />
                          </span>
                        ) : (
                          rotuloFaixa({ minimo: faixaMin, maximo: faixaMax })
                        ))}
                    </TableCell>
                    <TableCell className="text-right">
                      {numerico && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Evolução de ${r.nome}`}
                          onClick={() => setEvolucaoDe(r)}
                        >
                          <TrendingUp className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ))}

      <div className="panel grid gap-3 p-4">
        <div>
          <Label htmlFor="ex-obs">Observações do exame</Label>
          {aberto ? (
            <Textarea id="ex-obs" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} />
          ) : (
            <p className="text-sm whitespace-pre-wrap">{exame.observacoes || "—"}</p>
          )}
        </div>
        {aberto && (
          <p className="text-xs text-muted-foreground">
            A referência de cada campo é a do modelo na hora em que o exame foi aberto; ajuste aqui
            se o laudo trouxer outra. Mudar o modelo depois não altera este exame.
          </p>
        )}
      </div>

      {exame.adendos.length > 0 && (
        <div className="panel p-4">
          <h4 className="mb-2 text-sm font-semibold">Adendos</h4>
          <ul className="grid gap-2 text-sm">
            {exame.adendos.map((a) => (
              <li key={a.id} className="rounded-md border p-2">
                <p className="whitespace-pre-wrap">{a.texto}</p>
                <p className="text-xs text-muted-foreground">
                  {a.veterinario} (CRMV {a.crmv}-{a.crmv_uf}) · {dateTimeBR(a.created_at)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {exame.situacao === "fechado" && (
        <div className="panel grid gap-2 p-4">
          <Label htmlFor="ex-adendo">Novo adendo (correção ou complemento)</Label>
          <Textarea
            id="ex-adendo"
            rows={3}
            value={adendo}
            onChange={(e) => setAdendo(e.target.value)}
          />
          <div>
            <Button
              variant="outline"
              onClick={() => criarAdendo.mutate()}
              disabled={criarAdendo.isPending || !adendo.trim()}
            >
              Registrar adendo
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {aberto && (
          <>
            <Button onClick={() => salvar.mutate()} disabled={ocupado}>
              Salvar
            </Button>
            <Button variant="secondary" onClick={() => fechar.mutate()} disabled={ocupado}>
              Salvar e fechar exame
            </Button>
            <Button variant="outline" onClick={() => setCancelando(true)} disabled={ocupado}>
              Cancelar exame
            </Button>
          </>
        )}
        {exame.situacao !== "cancelado" && (
          <Button variant="outline" onClick={() => setLaudo(true)}>
            <Printer className="size-4" /> Laudo para imprimir
          </Button>
        )}
      </div>

      <Dialog open={cancelando} onOpenChange={(o) => !o && setCancelando(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar exame</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="ex-motivo">Motivo (fica registrado; o exame não se apaga)</Label>
            <Textarea
              id="ex-motivo"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelar.mutate()}
              disabled={cancelar.isPending || !motivo.trim()}
            >
              Cancelar o exame
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={laudo} onOpenChange={(o) => !o && setLaudo(false)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Laudo do exame</DialogTitle>
          </DialogHeader>
          <Laudo exame={exame} valores={valores} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLaudo(false)}>
              Fechar
            </Button>
            <Button onClick={() => window.print()}>
              <Printer className="size-4" /> Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!evolucaoDe} onOpenChange={(o) => !o && setEvolucaoDe(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Evolução — {evolucaoDe?.nome}</DialogTitle>
          </DialogHeader>
          {evolucaoDe && <Evolucao petId={petId} campo={evolucaoDe} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function parseFaixa(s: string | undefined): number | null {
  const t = (s ?? "").trim().replace(",", ".");
  if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

function Evolucao({ petId, campo }: { petId: string; campo: ResultadoExame }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["clinica-exame-evolucao", petId, campo.nome, campo.unidade],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exame_evolucao", {
        p_pet_id: petId,
        p_nome: campo.nome,
        p_unidade: campo.unidade ?? "",
      });
      if (error) throw error;
      return (data ?? []) as unknown as PontoEvolucao[];
    },
  });
  if (isLoading) return <div className="panel h-24 animate-pulse" />;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data || data.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Ainda não há exame fechado com este valor para o paciente.
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Coleta</TableHead>
          <TableHead>Exame</TableHead>
          <TableHead className="text-right">
            Valor{campo.unidade ? ` (${campo.unidade})` : ""}
          </TableHead>
          <TableHead>Referência</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((p, i) => {
          const v = variacao(i > 0 ? (data[i - 1]?.valor ?? null) : null, p.valor);
          const pos = situacaoNaFaixa(p.valor, p.faixa_min, p.faixa_max);
          return (
            <TableRow key={p.exame_id}>
              <TableCell>{dateBR(p.data_coleta)}</TableCell>
              <TableCell>{p.exame}</TableCell>
              <TableCell
                className={`text-right ${pos && pos !== "dentro" ? "font-semibold text-destructive" : ""}`}
              >
                {formatarNumero(p.valor, p.casas)}
                {v === "subiu" && <ArrowUp className="ml-1 inline size-3" aria-label="subiu" />}
                {v === "desceu" && <ArrowDown className="ml-1 inline size-3" aria-label="desceu" />}
              </TableCell>
              <TableCell>{rotuloFaixa({ minimo: p.faixa_min, maximo: p.faixa_max })}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Laudo de papel: só valores, unidades, faixas e observações do exame (nada do prontuário). */
function Laudo({
  exame,
  valores,
}: {
  exame: ExameClinico;
  valores: Record<string, number | null>;
}) {
  const feitos = exame.resultados.filter((r) =>
    r.forma === "texto" || r.forma === "escolha"
      ? r.valor_texto !== null
      : (valores[r.id] ?? r.valor_num) !== null,
  );
  const grupos = agruparCampos(feitos);
  return (
    <div id="documento-impresso" className="grid gap-3 bg-card text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-2">
        <div>
          <p className="font-display text-lg font-bold uppercase">{exame.nome}</p>
          <p className="text-muted-foreground">
            {exame.material ? `Material: ${exame.material}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p>Coleta: {dateBR(exame.data_coleta)}</p>
          {exame.laboratorio && <p>Laboratório: {exame.laboratorio}</p>}
        </div>
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        <p>
          <span className="text-muted-foreground">Paciente: </span>
          {exame.pet.nome} · {rotulo(ESPECIES, exame.pet.especie)}
          {exame.pet.raca ? ` · ${exame.pet.raca}` : ""}
          {exame.pet.nascimento ? ` · ${idadeDoPet(exame.pet.nascimento)}` : ""}
        </p>
        <p>
          <span className="text-muted-foreground">Tutor(a): </span>
          {exame.tutor}
        </p>
        <p>
          <span className="text-muted-foreground">Veterinário(a): </span>
          {exame.veterinario.nome} · CRMV {exame.veterinario.crmv}-{exame.veterinario.crmv_uf}
        </p>
        <p>
          <span className="text-muted-foreground">Situação: </span>
          {rotulo(SITUACOES_EXAME, exame.situacao)}
        </p>
      </div>
      {grupos.map((g) => (
        <div key={g.grupo || "__geral"}>
          {g.grupo && <p className="mt-2 font-semibold">{g.grupo}</p>}
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 font-medium">Campo</th>
                <th className="py-1 text-right font-medium">Resultado</th>
                <th className="py-1 pl-3 font-medium">Unidade</th>
                <th className="py-1 font-medium">Referência</th>
              </tr>
            </thead>
            <tbody>
              {g.campos.map((r) => {
                const numerico = r.forma === "numero" || r.forma === "calculado";
                const v = numerico ? (valores[r.id] ?? r.valor_num) : null;
                const pos = situacaoNaFaixa(v, r.faixa_min, r.faixa_max);
                return (
                  <tr key={r.id} className="border-b align-top">
                    <td className="py-1">
                      {r.nome}
                      {r.nota && (
                        <span className="block text-xs text-muted-foreground">{r.nota}</span>
                      )}
                    </td>
                    <td className={`py-1 text-right ${pos && pos !== "dentro" ? "font-bold" : ""}`}>
                      {numerico && v !== null ? formatarNumero(v, r.casas) : valorDoResultado(r)}
                      {pos === "abaixo" && " ↓"}
                      {pos === "acima" && " ↑"}
                    </td>
                    <td className="py-1 pl-3">{numerico ? r.unidade || "" : ""}</td>
                    <td className="py-1">
                      {numerico ? rotuloFaixa({ minimo: r.faixa_min, maximo: r.faixa_max }) : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {exame.observacoes && (
        <p className="whitespace-pre-wrap">
          <span className="font-semibold">Observações: </span>
          {exame.observacoes}
        </p>
      )}
      {exame.adendos.length > 0 && (
        <div>
          <p className="font-semibold">Adendos</p>
          {exame.adendos.map((a) => (
            <p key={a.id} className="whitespace-pre-wrap">
              {a.texto}{" "}
              <span className="text-xs text-muted-foreground">
                — {a.veterinario}, CRMV {a.crmv}-{a.crmv_uf}, {dateTimeBR(a.created_at)}
              </span>
            </p>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Valores de referência conforme o modelo da clínica ou o laudo do laboratório; a
        interpretação é do médico veterinário. Setas: ↑ acima e ↓ abaixo da referência.
      </p>
    </div>
  );
}
