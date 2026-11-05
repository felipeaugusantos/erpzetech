import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, Plus, Printer, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { SinaisVitaisInternacao } from "@/components/app/SinaisVitaisInternacao";
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
import { brl, dateTimeBR, num } from "@/lib/format";
import {
  SITUACOES_INTERNACAO,
  TIPOS_OCORRENCIA,
  descricaoDaFrequencia,
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

            <SinaisVitaisInternacao
              internacaoId={id}
              aberta={aberta}
              admitidoEm={f.internacao.admitido_em}
              souVet={souVet}
            />

            <PrescricaoSecao
              f={f}
              id={id}
              souVet={souVet}
              aberta={aberta}
              aoMudar={depois}
              aoErro={erro}
            />
            <ItensSecao
              f={f}
              id={id}
              souVet={souVet}
              aberta={aberta}
              aoMudar={depois}
              aoErro={erro}
            />

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

            <DialogFooter className="flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/clinica-internacao-historico" search={{ id }}>
                  <Printer className="size-4" /> Imprimir histórico
                </Link>
              </Button>
              {aberta && souVet && (
                <>
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
                </>
              )}
            </DialogFooter>
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

type PropsSecao = {
  f: FichaInternacao;
  id: string;
  souVet: boolean;
  aberta: boolean;
  aoMudar: () => void;
  aoErro: (e: Error) => void;
};

const SITUACAO_DOSE: Record<string, string> = {
  pendente: "Pendente",
  executada: "Feita",
  nao_executada: "Não feita",
  cancelada: "Cancelada",
};

function PrescricaoSecao({ f, id, souVet, aberta, aoMudar, aoErro }: PropsSecao) {
  const vazio = { medicamento: "", dose: "", via: "", frequencia: "", dias: "", observacao: "" };
  const [form, setForm] = useState(vazio);
  const [suspendendo, setSuspendendo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const prescrever = useMutation({
    mutationFn: async () => {
      if (!form.medicamento.trim() || !form.dose.trim())
        throw new Error("Informe o medicamento e a dose.");
      const freq = form.frequencia.trim() ? Number(form.frequencia) : null;
      const dias = form.dias.trim() ? Number(form.dias) : null;
      if ((freq === null) !== (dias === null))
        throw new Error(
          "Informe a frequência e a duração, ou deixe as duas vazias para dose única.",
        );
      const { error } = await supabase.rpc("clinica_internacao_prescrever", {
        p_id: id,
        p_dados: {
          medicamento: form.medicamento,
          dose: form.dose,
          via: form.via,
          observacao: form.observacao,
          ...(freq !== null && dias !== null ? { frequencia_horas: freq, dias } : {}),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Prescrição registrada. As doses entraram no mapa de execuções.");
      setForm(vazio);
      aoMudar();
    },
    onError: aoErro,
  });
  const suspender = useMutation({
    mutationFn: async () => {
      if (!suspendendo) return;
      const { error } = await supabase.rpc("clinica_prescricao_suspender", {
        p_prescricao_id: suspendendo,
        p_motivo: motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Prescrição suspensa.");
      setSuspendendo(null);
      setMotivo("");
      aoMudar();
    },
    onError: aoErro,
  });

  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">Prescrição médica</h4>
      {aberta && souVet && (
        <div className="mb-3 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-6">
          <div className="sm:col-span-3">
            <Label htmlFor="pr-med" className="text-xs">
              Medicamento
            </Label>
            <Input
              id="pr-med"
              maxLength={120}
              value={form.medicamento}
              onChange={(e) => setForm({ ...form, medicamento: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="pr-dose" className="text-xs">
              Dose
            </Label>
            <Input
              id="pr-dose"
              maxLength={80}
              placeholder="Ex.: 25 mg/kg"
              value={form.dose}
              onChange={(e) => setForm({ ...form, dose: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="pr-via" className="text-xs">
              Via
            </Label>
            <Input
              id="pr-via"
              maxLength={40}
              placeholder="IV, VO…"
              value={form.via}
              onChange={(e) => setForm({ ...form, via: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="pr-freq" className="text-xs">
              A cada (h)
            </Label>
            <Input
              id="pr-freq"
              inputMode="numeric"
              placeholder="dose única"
              value={form.frequencia}
              onChange={(e) => setForm({ ...form, frequencia: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="pr-dias" className="text-xs">
              Por (dias)
            </Label>
            <Input
              id="pr-dias"
              inputMode="numeric"
              value={form.dias}
              onChange={(e) => setForm({ ...form, dias: e.target.value })}
            />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="pr-obs" className="text-xs">
              Observação
            </Label>
            <Input
              id="pr-obs"
              maxLength={300}
              value={form.observacao}
              onChange={(e) => setForm({ ...form, observacao: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={() => prescrever.mutate()} disabled={prescrever.isPending}>
              Prescrever
            </Button>
          </div>
        </div>
      )}
      {f.prescricoes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma prescrição.</p>
      ) : (
        <div className="space-y-2">
          {f.prescricoes.map((p) => {
            const feitas = p.execucoes.filter((e) => e.situacao === "executada").length;
            return (
              <div
                key={p.id}
                className={`rounded-md border border-border p-3 text-sm ${p.situacao === "suspensa" ? "opacity-70" : ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p>
                    <strong>{p.medicamento}</strong> · {p.dose}
                    {p.via ? ` · ${p.via}` : ""} · {descricaoDaFrequencia(p)}
                    {p.observacao ? (
                      <span className="block text-xs text-muted-foreground">{p.observacao}</span>
                    ) : null}
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge variant={p.situacao === "ativa" ? "default" : "outline"}>
                      {p.situacao === "ativa"
                        ? `${feitas}/${p.execucoes.length} feitas`
                        : "Suspensa"}
                    </Badge>
                    {aberta && souVet && p.situacao === "ativa" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSuspendendo(p.id);
                          setMotivo("");
                        }}
                      >
                        Suspender
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.veterinario} (CRMV {p.crmv}/{p.crmv_uf}) · desde {dateTimeBR(p.inicio)}
                  {p.suspensa_motivo
                    ? ` · suspensa em ${dateTimeBR(p.suspensa_em)}: ${p.suspensa_motivo}`
                    : ""}
                </p>
                <p className="mt-1 flex flex-wrap gap-1">
                  {p.execucoes.map((e) => (
                    <span
                      key={e.id}
                      className="rounded border border-border px-1.5 py-0.5 text-xs"
                      title={`${SITUACAO_DOSE[e.situacao]}${e.executado_por ? ` por ${e.executado_por}` : ""}${e.observacao ? ` — ${e.observacao}` : ""}`}
                    >
                      {dateTimeBR(e.previsto_em)} · {SITUACAO_DOSE[e.situacao]}
                    </span>
                  ))}
                </p>
              </div>
            );
          })}
        </div>
      )}
      {suspendendo && (
        <Dialog open onOpenChange={(o) => !o && setSuspendendo(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Suspender prescrição</DialogTitle>
            </DialogHeader>
            <Label htmlFor="pr-motivo">Motivo (as doses que faltam serão canceladas)</Label>
            <Textarea
              id="pr-motivo"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setSuspendendo(null)}>
                Voltar
              </Button>
              <Button
                onClick={() => suspender.mutate()}
                disabled={suspender.isPending || !motivo.trim()}
              >
                Suspender
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ItensSecao({ f, id, souVet, aberta, aoMudar, aoErro }: PropsSecao) {
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [produto, setProduto] = useState("");
  const [descricao, setDescricao] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [preco, setPreco] = useState("");
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const achados = useQuery({
    queryKey: ["clinica-internacao-catalogo", termo],
    enabled: termo.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_internacao_catalogo", { p_busca: termo });
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string;
        descricao: string;
        preco_venda: number | null;
        controla_estoque: boolean;
      }[];
    },
  });

  const lancar = useMutation({
    mutationFn: async () => {
      const qtd = Number(quantidade.replace(",", "."));
      if (!(qtd > 0)) throw new Error("Quantidade inválida.");
      const valor = preco.trim() === "" ? undefined : Number(preco.replace(",", "."));
      if (valor !== undefined && !(valor >= 0)) throw new Error("Preço inválido.");
      if (!produto && !descricao.trim())
        throw new Error("Escolha um produto ou descreva o serviço.");
      const { error } = await supabase.rpc("clinica_internacao_item_lancar", {
        p_id: id,
        p_dados: {
          ...(produto ? { produto_id: produto } : { descricao }),
          quantidade: qtd,
          ...(valor !== undefined ? { preco: valor } : {}),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setProduto("");
      setDescricao("");
      setQuantidade("1");
      setPreco("");
      aoMudar();
    },
    onError: aoErro,
  });
  const cancelar = useMutation({
    mutationFn: async () => {
      if (!cancelando) return;
      const { error } = await supabase.rpc("clinica_internacao_item_cancelar", {
        p_item_id: cancelando,
        p_motivo: motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item cancelado.");
      setCancelando(null);
      setMotivo("");
      aoMudar();
    },
    onError: aoErro,
  });

  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">
        Produtos e serviços
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          Total {brl(Number(f.total_itens))}
        </span>
      </h4>
      {aberta && (
        <div className="mb-3 grid gap-2 rounded-md border border-border p-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setTermo(busca.trim());
              setProduto("");
            }}
          >
            <Input
              aria-label="Buscar produto ou serviço"
              placeholder="Buscar no cadastro de produtos"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={busca.trim().length < 2}>
              Buscar
            </Button>
          </form>
          {termo && (
            <Select
              value={produto || NENHUM}
              onValueChange={(v) => {
                setProduto(v === NENHUM ? "" : v);
                const p = (achados.data ?? []).find((x) => x.id === v);
                if (p) setPreco(String(p.preco_venda ?? "").replace(".", ","));
              }}
            >
              <SelectTrigger aria-label="Produto ou serviço">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUM}>
                  {achados.isLoading
                    ? "Buscando…"
                    : (achados.data ?? []).length
                      ? "Escolha…"
                      : "Nada encontrado (use item avulso)"}
                </SelectItem>
                {(achados.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.descricao}
                    {p.controla_estoque ? "" : " (serviço)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_5rem_7rem_auto]">
            {!produto ? (
              <Input
                aria-label="Descrição do item avulso"
                placeholder="Ou descreva um serviço avulso"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
              />
            ) : (
              <p className="self-center text-sm text-muted-foreground">
                Produto escolhido; a quantidade sai do estoque.
              </p>
            )}
            <Input
              aria-label="Quantidade"
              inputMode="decimal"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
            <Input
              aria-label="Preço (R$)"
              inputMode="decimal"
              placeholder="Preço"
              value={preco}
              onChange={(e) => setPreco(e.target.value)}
            />
            <Button onClick={() => lancar.mutate()} disabled={lancar.isPending}>
              Lançar
            </Button>
          </div>
        </div>
      )}
      {f.itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum item lançado.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {f.itens.map((i) => (
            <li
              key={i.id}
              className={`flex flex-wrap items-center justify-between gap-2 py-1 ${i.cancelado_em ? "opacity-60" : ""}`}
            >
              <span className={i.cancelado_em ? "line-through" : ""}>
                {i.descricao} · {String(i.quantidade).replace(".", ",")} ×{" "}
                {brl(Number(i.preco_unitario))} = <strong>{brl(Number(i.total))}</strong>
                <span className="ml-2 text-xs text-muted-foreground">
                  {i.tipo === "produto" ? "Produto" : "Serviço"} · {i.lancado_por}
                </span>
                {i.cancelado_em && (
                  <span className="ml-2 text-xs no-underline">cancelado: {i.cancelado_motivo}</span>
                )}
              </span>
              {aberta && souVet && !i.cancelado_em && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCancelando(i.id);
                    setMotivo("");
                  }}
                >
                  Cancelar item
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {cancelando && (
        <Dialog open onOpenChange={(o) => !o && setCancelando(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Cancelar item</DialogTitle>
            </DialogHeader>
            <Label htmlFor="it-motivo">Motivo (o produto volta ao estoque)</Label>
            <Textarea
              id="it-motivo"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelando(null)}>
                Voltar
              </Button>
              <Button
                onClick={() => cancelar.mutate()}
                disabled={cancelar.isPending || !motivo.trim()}
              >
                Cancelar item
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
