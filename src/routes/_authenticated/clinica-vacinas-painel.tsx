import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, MessageCircle } from "lucide-react";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { linkWhatsApp } from "@/lib/contato-pet";
import { dateBR } from "@/lib/format";
import {
  filtrarPainel,
  resumoPainel,
  type FiltroPainel,
  type LinhaPainelVacina,
} from "@/lib/vacinas-painel";

export const Route = createFileRoute("/_authenticated/clinica-vacinas-painel")({
  head: () => ({
    meta: [
      { title: "Painel de vacinas — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Vacinas em atraso e próximos reforços de todos os pets, com tutor e data de vencimento.",
      },
    ],
  }),
  component: PainelModulo,
});

function PainelModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Painel />;
}

function Painel() {
  const [janela, setJanela] = useState("30");
  const [filtro, setFiltro] = useState<FiltroPainel>("atrasadas");
  const [busca, setBusca] = useState("");
  const janelaN = Number(janela);
  const valido = Number.isInteger(janelaN) && janelaN >= 0 && janelaN <= 365;

  const { data, isLoading, error } = useQuery({
    queryKey: ["clinica-vacinas-painel", janelaN],
    enabled: valido,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_vacinas_painel", { p_janela: janelaN });
      if (error) throw error;
      return (data ?? []) as unknown as LinhaPainelVacina[];
    },
  });

  const todas = data ?? [];
  const resumo = resumoPainel(todas);
  const lista = filtrarPainel(todas, filtro, busca);

  return (
    <div>
      <PageHeader
        title="Painel de vacinas"
        description="Última dose de cada vacina por pet, com a data do próximo reforço. Mostra todos os pets ativos, mesmo os que já foram avisados."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          className="panel p-4 text-left"
          onClick={() => setFiltro("atrasadas")}
        >
          <div className="text-sm text-muted-foreground">Em atraso</div>
          <div className="text-2xl font-semibold text-destructive">{resumo.atrasadas}</div>
        </button>
        <button type="button" className="panel p-4 text-left" onClick={() => setFiltro("proximas")}>
          <div className="text-sm text-muted-foreground">
            Próximos {valido ? janelaN : "—"} dias
          </div>
          <div className="text-2xl font-semibold">{resumo.proximas}</div>
        </button>
        <button type="button" className="panel p-4 text-left" onClick={() => setFiltro("todas")}>
          <div className="text-sm text-muted-foreground">Pets na lista</div>
          <div className="text-2xl font-semibold">{resumo.pets}</div>
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Label htmlFor="vp-filtro">Mostrar</Label>
          <Select value={filtro} onValueChange={(v) => setFiltro(v as FiltroPainel)}>
            <SelectTrigger id="vp-filtro">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="atrasadas">Em atraso</SelectItem>
              <SelectItem value="proximas">Próximos reforços</SelectItem>
              <SelectItem value="todas">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label htmlFor="vp-janela">Próximos (dias)</Label>
          <Input
            id="vp-janela"
            inputMode="numeric"
            value={janela}
            onChange={(e) => setJanela(e.target.value)}
          />
        </div>
        <div className="min-w-56 flex-1">
          <Label htmlFor="vp-busca">Buscar tutor, pet ou vacina</Label>
          <Input id="vp-busca" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>
      {!valido && <p className="mb-3 text-sm text-destructive">Informe de 0 a 365 dias.</p>}

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : error ? (
        <EmptyState title="Não foi possível carregar" description={(error as Error).message} />
      ) : lista.length === 0 ? (
        <EmptyState title="Nada nesta lista" description="Nenhuma vacina para este filtro." />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vencimento</TableHead>
                <TableHead>Pet</TableHead>
                <TableHead>Tutor</TableHead>
                <TableHead>Vacina</TableHead>
                <TableHead>Última dose</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((l) => {
                const wa = linkWhatsApp(l.telefone, `Olá, ${l.tutor}!`);
                return (
                  <TableRow key={`${l.pet_id}-${l.vacina}-${l.proxima_dose_em}`}>
                    <TableCell className="whitespace-nowrap">
                      {dateBR(l.proxima_dose_em)}{" "}
                      {l.dias < 0 ? (
                        <Badge variant="destructive">há {-l.dias} dia(s)</Badge>
                      ) : l.dias === 0 ? (
                        <Badge variant="secondary">hoje</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">em {l.dias} dia(s)</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {l.pet}
                      {l.especie && (
                        <span className="block text-xs text-muted-foreground">{l.especie}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {l.tutor}
                      <span className="block text-xs text-muted-foreground">
                        {l.telefone ?? "sem telefone"}
                      </span>
                    </TableCell>
                    <TableCell>{l.vacina}</TableCell>
                    <TableCell className="whitespace-nowrap">{dateBR(l.aplicada_em)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <Link
                            to="/clinica-prontuario"
                            search={{ pet: l.pet_id }}
                            aria-label="Abrir prontuário"
                          >
                            <FileText className="size-4" />
                          </Link>
                        </Button>
                        {wa && (
                          <Button size="sm" variant="outline" asChild>
                            <a
                              href={wa}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label="Abrir WhatsApp"
                            >
                              <MessageCircle className="size-4" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
