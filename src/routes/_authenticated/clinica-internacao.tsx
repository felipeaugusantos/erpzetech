import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, Plus, TriangleAlert } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { dateTimeBR, num } from "@/lib/format";
import {
  SITUACOES_INTERNACAO,
  TIPOS_OCORRENCIA,
  diasInternado,
  rotuloSituacaoInternacao,
  rotuloTipoOcorrencia,
  variacaoDePeso,
  type Box,
  type FichaInternacao,
  type ResumoInternacao,
} from "@/lib/internacao";
import { ESPECIES, idadeDoPet, rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/clinica-internacao")({
  head: () => ({
    meta: [
      { title: "Internação — EZRA ERP" },
      {
        name: "description",
        content: "Mapa dos animais internados, boxes, pesagens, relatos médicos e ocorrências.",
      },
    ],
  }),
  component: InternacaoModulo,
});

const NENHUM = "__nenhum";

function InternacaoModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Internacao />;
}

function Internacao() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const souVet = (session?.roles ?? []).includes("veterinario");
  const [situacao, setSituacao] = useState("internado");
  const [admitindo, setAdmitindo] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ["clinica-internacoes", situacao],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_internacoes", { p_situacao: situacao });
      if (error) throw error;
      return (data ?? []) as unknown as ResumoInternacao[];
    },
  });
  const itens = lista.data ?? [];

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["clinica-internacoes"] });
    void qc.invalidateQueries({ queryKey: ["clinica-internacao"] });
    void qc.invalidateQueries({ queryKey: ["clinica-boxes"] });
  };

  return (
    <div>
      <PageHeader
        title="Internação"
        description="Mapa dos animais internados. Só o veterinário lê o motivo e os relatos médicos; o auxiliar registra pesagens e ocorrências."
        actions={
          souVet ? (
            <Button onClick={() => setAdmitindo(true)}>
              <Plus className="size-4" /> Internar animal
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 max-w-xs">
        <Select value={situacao} onValueChange={setSituacao}>
          <SelectTrigger aria-label="Situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SITUACOES_INTERNACAO.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {lista.isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : lista.error ? (
        <EmptyState
          title="Não foi possível abrir o mapa"
          description={(lista.error as Error).message}
        />
      ) : itens.length === 0 ? (
        <EmptyState
          title={situacao === "internado" ? "Nenhum animal internado" : "Nada por aqui"}
          description={
            souVet && situacao === "internado"
              ? "Use “Internar animal” para admitir um paciente em um box livre."
              : "Quando houver internações, elas aparecem aqui."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {itens.map((i) => (
            <button
              key={i.id}
              type="button"
              className="panel p-4 text-left hover:bg-muted"
              onClick={() => setAberta(i.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-base font-semibold">{i.pet.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {[rotulo(ESPECIES, i.pet.especie), i.pet.raca].filter(Boolean).join(" · ")} ·
                    tutor(a) {i.tutor}
                  </p>
                </div>
                <Badge variant={i.situacao === "internado" ? "default" : "outline"}>
                  {i.situacao === "internado" ? i.box.nome : rotuloSituacaoInternacao(i.situacao)}
                </Badge>
              </div>
              <p className="mt-2 text-sm">
                <BedDouble className="mr-1 inline size-4 text-muted-foreground" />
                {i.situacao === "internado"
                  ? `${diasInternado(i.admitido_em)}º dia · desde ${dateTimeBR(i.admitido_em)}`
                  : `${dateTimeBR(i.admitido_em)} → ${dateTimeBR(i.encerrado_em)}`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {i.ultimo_peso ? `Último peso ${num(Number(i.ultimo_peso), 2)} kg · ` : ""}
                {i.ocorrencias} ocorrência{i.ocorrencias === 1 ? "" : "s"} · {i.veterinario}
              </p>
              {i.pet.alergias && (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-800">
                  <TriangleAlert className="size-3" /> Alergia: {i.pet.alergias}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {admitindo && (
        <AdmitirDialog
          aoFechar={() => setAdmitindo(false)}
          aoAdmitir={(id) => {
            setAdmitindo(false);
            recarregar();
            setAberta(id);
          }}
        />
      )}
      {aberta && <FichaDialog id={aberta} aoFechar={() => setAberta(null)} aoMudar={recarregar} />}
    </div>
  );
}

function AdmitirDialog({
  aoFechar,
  aoAdmitir,
}: {
  aoFechar: () => void;
  aoAdmitir: (id: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [pet, setPet] = useState("");
  const [box, setBox] = useState("");
  const [motivo, setMotivo] = useState("");
  const [peso, setPeso] = useState("");
  const [obs, setObs] = useState("");

  const achados = useQuery({
    queryKey: ["clinica-pacientes", termo],
    enabled: termo.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_pacientes", { p_busca: termo });
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string;
        nome: string;
        especie: string;
        raca: string | null;
        tutor: string;
      }[];
    },
  });
  const boxes = useQuery({
    queryKey: ["clinica-boxes"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_boxes");
      if (error) throw error;
      return (data ?? []) as unknown as Box[];
    },
  });
  const livres = (boxes.data ?? []).filter((b) => b.ativo && !b.ocupado);

  const admitir = useMutation({
    mutationFn: async () => {
      if (!pet) throw new Error("Escolha o paciente.");
      if (!box) throw new Error("Escolha um box livre.");
      if (!motivo.trim()) throw new Error("Informe o motivo da internação.");
      const kg = peso.trim() ? Number(peso.replace(",", ".")) : null;
      if (kg !== null && (!Number.isFinite(kg) || kg <= 0 || kg > 200))
        throw new Error("Informe um peso entre 0,01 e 200 kg.");
      const { data, error } = await supabase.rpc("clinica_internacao_admitir", {
        p_pet_id: pet,
        p_dados: { box_id: box, motivo, observacoes: obs, ...(kg !== null ? { peso_kg: kg } : {}) },
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Animal internado.");
      aoAdmitir(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Internar animal</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setTermo(busca.trim());
              setPet("");
            }}
          >
            <Input
              aria-label="Buscar paciente"
              placeholder="Nome do pet ou do tutor"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={busca.trim().length < 2}>
              Buscar
            </Button>
          </form>
          {termo && (
            <Select value={pet || NENHUM} onValueChange={(v) => setPet(v === NENHUM ? "" : v)}>
              <SelectTrigger aria-label="Paciente">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUM}>
                  {achados.isLoading
                    ? "Buscando…"
                    : (achados.data ?? []).length
                      ? "Escolha o paciente…"
                      : "Nenhum paciente encontrado"}
                </SelectItem>
                {(achados.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome} — {p.tutor}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div>
            <Label htmlFor="in-box">Box</Label>
            <Select value={box || NENHUM} onValueChange={(v) => setBox(v === NENHUM ? "" : v)}>
              <SelectTrigger id="in-box">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUM}>
                  {livres.length
                    ? "Escolha o box…"
                    : "Nenhum box livre: cadastre em Boxes de internação"}
                </SelectItem>
                {livres.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="in-motivo">Motivo da internação</Label>
            <Textarea
              id="in-motivo"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="in-peso">Peso na admissão (kg)</Label>
              <Input
                id="in-peso"
                inputMode="decimal"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="in-obs">Observações</Label>
              <Input id="in-obs" value={obs} onChange={(e) => setObs(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button onClick={() => admitir.mutate()} disabled={admitir.isPending}>
            Internar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FichaDialog({
  id,
  aoFechar,
  aoMudar,
}: {
  id: string;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const qc = useQueryClient();
  const [peso, setPeso] = useState("");
  const [tipo, setTipo] = useState("intercorrencia");
  const [ocorrencia, setOcorrencia] = useState("");
  const [relato, setRelato] = useState("");
  const [novoBox, setNovoBox] = useState("");
  const [encerrando, setEncerrando] = useState<"alta" | "obito" | null>(null);
  const [textoFim, setTextoFim] = useState("");

  const ficha = useQuery({
    queryKey: ["clinica-internacao", id],
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_internacao_obter", { p_id: id });
      if (error) throw error;
      return data as unknown as FichaInternacao;
    },
  });
  const boxes = useQuery({
    queryKey: ["clinica-boxes"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_boxes");
      if (error) throw error;
      return (data ?? []) as unknown as Box[];
    },
  });

  const depois = () => {
    void qc.invalidateQueries({ queryKey: ["clinica-internacao", id] });
    aoMudar();
  };
  const erro = (e: Error) => toast.error(e.message);

  const pesar = useMutation({
    mutationFn: async () => {
      const kg = Number(peso.replace(",", "."));
      if (!Number.isFinite(kg) || kg <= 0 || kg > 200)
        throw new Error("Informe um peso entre 0,01 e 200 kg.");
      const { error } = await supabase.rpc("clinica_internacao_pesagem", {
        p_id: id,
        p_peso_kg: kg,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setPeso("");
      depois();
    },
    onError: erro,
  });
  const ocorrer = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clinica_internacao_ocorrencia", {
        p_id: id,
        p_tipo: tipo,
        p_texto: ocorrencia,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setOcorrencia("");
      depois();
    },
    onError: erro,
  });
  const relatar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clinica_internacao_relato", {
        p_id: id,
        p_texto: relato,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setRelato("");
      depois();
    },
    onError: erro,
  });
  const trocar = useMutation({
    mutationFn: async () => {
      if (!novoBox) throw new Error("Escolha o box de destino.");
      const { error } = await supabase.rpc("clinica_internacao_box_trocar", {
        p_id: id,
        p_box_id: novoBox,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNovoBox("");
      toast.success("Animal transferido.");
      depois();
    },
    onError: erro,
  });
  const encerrar = useMutation({
    mutationFn: async () => {
      if (!encerrando) return;
      const { error } = await supabase.rpc("clinica_internacao_encerrar", {
        p_id: id,
        p_tipo: encerrando,
        p_texto: textoFim,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(encerrando === "alta" ? "Alta registrada." : "Óbito registrado.");
      setEncerrando(null);
      setTextoFim("");
      depois();
    },
    onError: erro,
  });

  const f = ficha.data;
  const aberta = f?.internacao.situacao === "internado";
  const souVet = f?.sou_veterinario ?? false;
  const livres = (boxes.data ?? []).filter((b) => b.ativo && !b.ocupado);
  const variacao = f ? variacaoDePeso(f.pesagens) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        {ficha.isLoading ? (
          <div className="h-40 animate-pulse" />
        ) : ficha.error || !f ? (
          <EmptyState
            title="Não foi possível abrir a ficha"
            description={(ficha.error as Error | null)?.message ?? ""}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {f.pet.nome} · {rotuloSituacaoInternacao(f.internacao.situacao)}
                {aberta ? ` · ${f.internacao.box.nome}` : ""}
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-1 rounded-md border border-border p-3 text-sm sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">Tutor(a): </span>
                {f.tutor}
                {f.tutor_telefone ? ` · ${f.tutor_telefone}` : ""}
              </p>
              <p>
                <span className="text-muted-foreground">Espécie / raça: </span>
                {rotulo(ESPECIES, f.pet.especie)}
                {f.pet.raca ? ` · ${f.pet.raca}` : ""}
                {f.pet.nascimento ? ` · ${idadeDoPet(f.pet.nascimento)}` : ""}
              </p>
              <p>
                <span className="text-muted-foreground">Admissão: </span>
                {dateTimeBR(f.internacao.admitido_em)} · {f.internacao.veterinario.nome} (CRMV{" "}
                {f.internacao.veterinario.crmv}/{f.internacao.veterinario.crmv_uf})
              </p>
              <p>
                <span className="text-muted-foreground">Peso / microchip: </span>
                {f.pet.peso_kg ? `${num(Number(f.pet.peso_kg), 2)} kg` : "—"}
                {f.pet.microchip ? ` · ${f.pet.microchip}` : ""}
              </p>
              {f.pet.alergias && (
                <p className="flex items-center gap-1 text-amber-800 sm:col-span-2">
                  <TriangleAlert className="size-4" /> Alergia: <strong>{f.pet.alergias}</strong>
                </p>
              )}
              {souVet && f.internacao.motivo && (
                <p className="sm:col-span-2">
                  <span className="text-muted-foreground">Motivo: </span>
                  {f.internacao.motivo}
                  {f.internacao.observacoes ? ` — ${f.internacao.observacoes}` : ""}
                </p>
              )}
              {f.internacao.encerrado_em && (
                <p className="sm:col-span-2">
                  <span className="text-muted-foreground">
                    {f.internacao.situacao === "obito" ? "Óbito" : "Alta"} em{" "}
                    {dateTimeBR(f.internacao.encerrado_em)}
                  </span>
                  {souVet && f.internacao.encerramento_texto
                    ? `: ${f.internacao.encerramento_texto}`
                    : ""}
                </p>
              )}
            </div>

            {aberta && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-border p-3">
                  <Label htmlFor="fi-peso" className="text-sm font-medium">
                    Pesagem
                  </Label>
                  <div className="mt-1 flex gap-2">
                    <Input
                      id="fi-peso"
                      inputMode="decimal"
                      placeholder="kg"
                      value={peso}
                      onChange={(e) => setPeso(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      onClick={() => pesar.mutate()}
                      disabled={pesar.isPending || !peso.trim()}
                    >
                      Registrar
                    </Button>
                  </div>
                </div>
                {souVet && (
                  <div className="rounded-md border border-border p-3">
                    <Label htmlFor="fi-box" className="text-sm font-medium">
                      Transferir de box
                    </Label>
                    <div className="mt-1 flex gap-2">
                      <Select
                        value={novoBox || NENHUM}
                        onValueChange={(v) => setNovoBox(v === NENHUM ? "" : v)}
                      >
                        <SelectTrigger id="fi-box">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NENHUM}>
                            {livres.length ? "Box livre…" : "Nenhum box livre"}
                          </SelectItem>
                          {livres.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        onClick={() => trocar.mutate()}
                        disabled={trocar.isPending || !novoBox}
                      >
                        Transferir
                      </Button>
                    </div>
                  </div>
                )}
                <div className="rounded-md border border-border p-3 sm:col-span-2">
                  <p className="text-sm font-medium">Ocorrência</p>
                  <div className="mt-1 grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                    <Select value={tipo} onValueChange={setTipo}>
                      <SelectTrigger aria-label="Tipo de ocorrência">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIPOS_OCORRENCIA.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label="Descrição da ocorrência"
                      maxLength={1000}
                      placeholder="O que aconteceu"
                      value={ocorrencia}
                      onChange={(e) => setOcorrencia(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      onClick={() => ocorrer.mutate()}
                      disabled={ocorrer.isPending || !ocorrencia.trim()}
                    >
                      Registrar
                    </Button>
                  </div>
                </div>
                {souVet && (
                  <div className="rounded-md border border-border p-3 sm:col-span-2">
                    <Label htmlFor="fi-relato" className="text-sm font-medium">
                      Relato médico
                    </Label>
                    <Textarea
                      id="fi-relato"
                      rows={3}
                      className="mt-1"
                      value={relato}
                      onChange={(e) => setRelato(e.target.value)}
                    />
                    <Button
                      className="mt-2"
                      size="sm"
                      onClick={() => relatar.mutate()}
                      disabled={relatar.isPending || !relato.trim()}
                    >
                      Registrar relato
                    </Button>
                  </div>
                )}
              </div>
            )}

            {souVet && f.relatos && (
              <div>
                <h4 className="mb-1 text-sm font-semibold">Relatos médicos</h4>
                {f.relatos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum relato ainda.</p>
                ) : (
                  f.relatos.map((r) => (
                    <div
                      key={r.id}
                      className="mb-2 rounded-md border-l-4 border-primary bg-muted/50 p-3 text-sm"
                    >
                      <p className="whitespace-pre-wrap">{r.texto}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {r.veterinario} (CRMV {r.crmv}/{r.crmv_uf}) · {dateTimeBR(r.created_at)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h4 className="mb-1 text-sm font-semibold">Ocorrências</h4>
                {f.ocorrencias.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma ocorrência.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {f.ocorrencias.map((o) => (
                      <li key={o.id}>
                        <Badge variant="outline" className="mr-1">
                          {rotuloTipoOcorrencia(o.tipo)}
                        </Badge>
                        {o.texto}
                        <span className="block text-xs text-muted-foreground">
                          {o.profissional} · {dateTimeBR(o.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4 className="mb-1 text-sm font-semibold">
                  Pesagens
                  {variacao !== null && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {variacao > 0 ? "+" : ""}
                      {num(variacao, 2)} kg desde a primeira
                    </span>
                  )}
                </h4>
                {f.pesagens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma pesagem.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {f.pesagens.map((p) => (
                      <li key={p.id}>
                        <strong>{num(Number(p.peso_kg), 2)} kg</strong>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {dateTimeBR(p.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {aberta && souVet && (
              <DialogFooter className="flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEncerrando("alta");
                    setTextoFim("");
                  }}
                >
                  Dar alta
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setEncerrando("obito");
                    setTextoFim("");
                  }}
                >
                  Registrar óbito
                </Button>
              </DialogFooter>
            )}

            {encerrando && (
              <Dialog open onOpenChange={(o) => !o && setEncerrando(null)}>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>
                      {encerrando === "alta" ? "Registrar alta" : "Registrar óbito"}
                    </DialogTitle>
                  </DialogHeader>
                  <Label htmlFor="fi-fim">
                    {encerrando === "alta"
                      ? "Resumo da alta e orientações ao tutor"
                      : "Causa e circunstâncias do óbito"}
                  </Label>
                  <Textarea
                    id="fi-fim"
                    rows={4}
                    value={textoFim}
                    onChange={(e) => setTextoFim(e.target.value)}
                  />
                  {encerrando === "obito" && (
                    <p className="text-xs text-muted-foreground">
                      O cadastro do animal fica inativo e a data do óbito é guardada. Não dá para
                      desfazer.
                    </p>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setEncerrando(null)}>
                      Voltar
                    </Button>
                    <Button
                      variant={encerrando === "obito" ? "destructive" : "default"}
                      onClick={() => encerrar.mutate()}
                      disabled={encerrar.isPending || !textoFim.trim()}
                    >
                      Confirmar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
