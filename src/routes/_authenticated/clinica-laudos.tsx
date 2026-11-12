import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, FileText, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { MiniGraficoExame } from "@/components/app/MiniGraficoExame";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useModulosCnae } from "@/lib/cnae";
import { SITUACOES_EXAME, formatarNumero, rotuloFaixa, valorDoResultado, type ExameClinico, type ResumoExame } from "@/lib/exames";
import { evolucaoDosLaudos } from "@/lib/laudos-pet";
import { ESPECIES, rotulo } from "@/lib/pet";
import { dateBR } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/clinica-laudos")({
  validateSearch: (search: Record<string, unknown>) => ({ pet: typeof search["pet"] === "string" ? search["pet"] : undefined }),
  head: () => ({ meta: [
    { title: "Laudos e evolução do pet — ERP Ze Tech" },
    { name: "description", content: "Laudos do paciente, valores anteriores e evolução dos resultados veterinários." },
    { property: "og:title", content: "Laudos e evolução do pet — ERP Ze Tech" },
    { property: "og:description", content: "Histórico de laudos e minigráficos dos resultados do paciente." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Tela,
});

type Lista = { pet: { nome: string; especie: string; raca: string | null }; tutor: string; exames: ResumoExame[] };
function Tela() {
  const { pet } = Route.useSearch();
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  if (!pet) return <EmptyState title="Escolha um paciente" action={<Button asChild><Link to="/clinica-exames" search={{ pet: undefined, exame: undefined, atendimento: undefined }}>Exames</Link></Button>} />;
  return <Laudos key={pet} petId={pet} />;
}

function Laudos({ petId }: { petId: string }) {
  const [busca, setBusca] = useState("");
  const lista = useQuery({ queryKey: ["clinica-exames-pet", petId], queryFn: async () => {
    const { data, error } = await supabase.rpc("clinica_exames_do_pet", { p_pet_id: petId });
    if (error) throw error;
    return data as unknown as Lista;
  } });
  const detalhes = useQueries({ queries: (lista.data?.exames ?? []).map(e => ({
    queryKey: ["clinica-exame", e.id], queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exame_get", { p_id: e.id });
      if (error) throw error;
      return data as unknown as ExameClinico;
    },
  })) });
  const exames = detalhes.flatMap(d => d.data ? [d.data] : []);
  const grupos = evolucaoDosLaudos(exames).filter(g => g.nome.toLowerCase().includes(busca.trim().toLowerCase()));
  const falha = lista.error ?? detalhes.find(d => d.error)?.error;
  const carregando = lista.isPending || detalhes.some(d => d.isPending);
  return <div className="min-w-0">
    <PageHeader title={lista.data ? `Laudos — ${lista.data.pet.nome}` : "Laudos do paciente"} />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <p className="text-sm text-muted-foreground">{lista.data && <>{rotulo(ESPECIES, lista.data.pet.especie)}{lista.data.pet.raca ? ` · ${lista.data.pet.raca}` : ""} · Tutor(a): {lista.data.tutor}</>}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm"><Link to="/clinica-prontuario" search={{ pet: petId }}><ArrowLeft className="size-4" />Prontuário</Link></Button>
        <Button asChild variant="outline" size="sm"><Link to="/clinica-exames" search={{ pet: petId, exame: undefined, atendimento: undefined }}><ClipboardList className="size-4" />Exames</Link></Button>
      </div>
    </div>
    {falha ? <div className="grid gap-2"><p className="text-sm text-destructive">{falha.message}</p><Button variant="outline" onClick={() => { void lista.refetch(); detalhes.forEach(d => { void d.refetch(); }); }}>Tentar novamente</Button></div> : carregando ? <div className="h-40 animate-pulse bg-muted" aria-label="Carregando laudos" /> : <Tabs defaultValue="laudos">
      <TabsList><TabsTrigger value="laudos"><FileText className="size-4" />Todos os laudos ({exames.length})</TabsTrigger><TabsTrigger value="evolucao"><TrendingUp className="size-4" />Evolução</TabsTrigger></TabsList>
      <TabsContent value="laudos" className="mt-4 grid gap-3">
        {!exames.length && <EmptyState title="Nenhum laudo registrado" />}
        {exames.map(e => <details key={e.id} className="min-w-0 border-b pb-3">
          <summary className="cursor-pointer py-3"><span className="font-semibold">{e.nome}</span><span className="ml-2 text-sm text-muted-foreground">{dateBR(e.data_coleta)}{e.laboratorio ? ` · ${e.laboratorio}` : ""}</span><Badge className="ml-2" variant={e.situacao === "fechado" ? "default" : "outline"}>{rotulo(SITUACOES_EXAME, e.situacao)}</Badge></summary>
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{e.veterinario.nome} · CRMV {e.veterinario.crmv}-{e.veterinario.crmv_uf}</p>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Campo</TableHead><TableHead>Resultado</TableHead><TableHead>Referência</TableHead></TableRow></TableHeader><TableBody>{e.resultados.map(r => <TableRow key={r.id}><TableCell>{r.nome}</TableCell><TableCell className="whitespace-nowrap">{valorDoResultado(r)} {r.unidade}</TableCell><TableCell>{rotuloFaixa({ minimo: r.faixa_min, maximo: r.faixa_max })}</TableCell></TableRow>)}</TableBody></Table></div>
            {e.observacoes && <p className="whitespace-pre-wrap text-sm">{e.observacoes}</p>}
            {e.adendos.map(a => <div key={a.id} className="border-l-2 pl-3 text-sm"><p className="font-medium">Adendo · {a.veterinario}</p><p className="whitespace-pre-wrap">{a.texto}</p></div>)}
            <div><Button asChild variant="outline" size="sm"><Link to="/clinica-exames" search={{ pet: petId, exame: e.id, atendimento: undefined }}>Abrir laudo</Link></Button></div>
          </div>
        </details>)}
      </TabsContent>
      <TabsContent value="evolucao" className="mt-4">
        <Input aria-label="Buscar resultado" placeholder="Buscar campo do exame" className="mb-4 max-w-md" value={busca} onChange={e => setBusca(e.target.value)} />
        {!grupos.length && <EmptyState title={busca ? "Nenhum campo encontrado" : "Sem resultados fechados"} />}
        <div className="grid gap-x-8 gap-y-6 xl:grid-cols-2">{grupos.map(g => <section key={JSON.stringify([g.nome, g.unidade])} className="min-w-0 border-b pb-4">
          <h2 className="mb-2 font-semibold">{g.nome}{g.unidade ? ` (${g.unidade})` : ""}</h2>
          {g.pontos.length >= 2 && <MiniGraficoExame nome={g.nome} unidade={g.unidade} pontos={g.pontos.slice(-4)} />}
          <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Coleta</TableHead><TableHead>Resultado</TableHead><TableHead>Referência</TableHead><TableHead>Laudo</TableHead></TableRow></TableHeader><TableBody>{[...g.pontos].reverse().map(p => <TableRow key={p.exame_id}><TableCell className="whitespace-nowrap">{dateBR(p.data_coleta)}</TableCell><TableCell className="font-medium">{formatarNumero(p.valor, p.casas)}</TableCell><TableCell>{rotuloFaixa({ minimo: p.faixa_min, maximo: p.faixa_max })}</TableCell><TableCell><Link className="text-primary underline" to="/clinica-exames" search={{ pet: petId, exame: p.exame_id, atendimento: undefined }}>{p.exame}</Link></TableCell></TableRow>)}</TableBody></Table></div>
        </section>)}</div>
      </TabsContent>
    </Tabs>}
  </div>;
}