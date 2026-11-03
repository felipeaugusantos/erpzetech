import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { HospedeDialog } from "@/components/hotelaria/HospedeDialog";
import { ModuloHotelaria } from "@/components/hotelaria/ModuloHotelaria";
import { SituacaoBadge } from "@/components/hotelaria/SituacaoBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { filtrarHospedes } from "@/hooks/useHospedes";
import { dateBR } from "@/lib/format";
import { rotuloDocumento } from "@/lib/hotelaria";
import { hsDb, linhas } from "@/lib/hotelaria-api";
import type { HsHospede, HsReserva } from "@/lib/hotelaria-tipos";

export const Route = createFileRoute("/_authenticated/hotel-hospedes")({
  head: () => ({
    meta: [
      { title: "Hóspedes — EZRA ERP" },
      {
        name: "description",
        content:
          "Cadastro de hóspedes com os dados da ficha de hospedagem e o histórico de estadias.",
      },
    ],
  }),
  component: () => <ModuloHotelaria>{() => <Hospedes />}</ModuloHotelaria>,
});

function Hospedes() {
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<HsHospede | null>(null);
  const [novo, setNovo] = useState(false);
  const [historico, setHistorico] = useState<HsHospede | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["hotel-hospedes", "todos"],
    queryFn: async () =>
      linhas<HsHospede>(await hsDb.from("hs_hospedes").select("*").order("nome").limit(2000)),
  });
  const estadias = useQuery({
    queryKey: ["hotel-hospede-estadias", historico?.id],
    enabled: historico !== null,
    queryFn: async () =>
      linhas<HsReserva>(
        await hsDb
          .from("hs_reservas")
          .select("*")
          .eq("titular_id", historico!.id)
          .order("numero", { ascending: false })
          .limit(30),
      ),
  });

  const lista = useMemo(() => filtrarHospedes(data ?? [], busca), [data, busca]);

  return (
    <div>
      <PageHeader
        title="Hóspedes"
        description="Os dados daqui alimentam a ficha de hospedagem. O documento do titular é exigido no check-in."
        actions={
          <Button onClick={() => setNovo(true)}>
            <Plus className="size-4" /> Novo hóspede
          </Button>
        }
      />
      <div className="mb-4 max-w-sm">
        <Input
          aria-label="Buscar hóspede"
          placeholder="Buscar por nome, documento ou telefone"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>
      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum hóspede encontrado"
          description="Cadastre o hóspede aqui ou na hora de reservar."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.slice(0, 300).map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="font-medium">
                    {h.nome}
                    {!h.ativo && (
                      <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {h.documento_numero
                      ? `${rotuloDocumento(h.documento_tipo)} ${h.documento_numero}`
                      : "—"}
                  </TableCell>
                  <TableCell>{[h.telefone, h.email].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell>
                    {[h.cidade_residencia, h.estado_residencia].filter(Boolean).join(" / ") || "—"}
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setHistorico(h)}>
                      Estadias
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditando(h)}>
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {lista.length > 300 && (
            <p className="p-3 text-xs text-muted-foreground">
              Mostrando 300 de {lista.length}: refine a busca.
            </p>
          )}
        </div>
      )}

      <HospedeDialog
        aberto={novo || editando !== null}
        hospede={editando}
        onFechar={() => (setNovo(false), setEditando(null))}
      />

      <Dialog open={historico !== null} onOpenChange={(o) => !o && setHistorico(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Estadias de {historico?.nome}</DialogTitle>
          </DialogHeader>
          {estadias.isLoading ? (
            <div className="h-20 animate-pulse rounded bg-secondary" />
          ) : (estadias.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma reserva em que seja titular.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {(estadias.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <Link
                    to="/hotel-estadia/$id"
                    params={{ id: r.id }}
                    className="text-primary hover:underline"
                  >
                    Reserva {r.numero}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{dateBR(r.created_at)}</span>
                    <SituacaoBadge situacao={r.situacao} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
