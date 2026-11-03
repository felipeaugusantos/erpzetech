import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { ModuloHotelaria } from "@/components/hotelaria/ModuloHotelaria";
import { NovaReservaDialog } from "@/components/hotelaria/NovaReservaDialog";
import { SituacaoBadge } from "@/components/hotelaria/SituacaoBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { dateBR, dateTimeBR } from "@/lib/format";
import { SITUACOES_RESERVA, rotuloOrigem } from "@/lib/hotelaria";
import { hsDb, linhas } from "@/lib/hotelaria-api";
import type { Hotel, HsHospede, HsReserva, HsReservaUh, HsUh } from "@/lib/hotelaria-tipos";

export const Route = createFileRoute("/_authenticated/hotel-reservas")({
  head: () => ({
    meta: [
      { title: "Reservas do hotel — EZRA ERP" },
      {
        name: "description",
        content: "Lista de reservas com busca por número, hóspede e situação.",
      },
    ],
  }),
  component: () => <ModuloHotelaria>{(hotel) => <Reservas hotel={hotel} />}</ModuloHotelaria>,
});

const TODAS = "__todas";

function Reservas({ hotel }: { hotel: Hotel }) {
  const navegar = useNavigate();
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState(TODAS);
  const [nova, setNova] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["hotel-reservas", hotel.id],
    queryFn: async () => {
      const reservas = linhas<HsReserva>(
        await hsDb
          .from("hs_reservas")
          .select("*")
          .eq("filial_id", hotel.id)
          .order("numero", { ascending: false })
          .limit(500),
      );
      const ids = reservas.map((r) => r.id);
      const titularIds = [...new Set(reservas.map((r) => r.titular_id))];
      const quartos = ids.length
        ? linhas<HsReservaUh>(await hsDb.from("hs_reserva_uhs").select("*").in("reserva_id", ids))
        : [];
      const hospedes = titularIds.length
        ? linhas<HsHospede>(await hsDb.from("hs_hospedes").select("id, nome").in("id", titularIds))
        : [];
      const uhIds = [
        ...new Set(quartos.map((q) => q.uh_id).filter((x): x is string => Boolean(x))),
      ];
      const uhs = uhIds.length
        ? linhas<HsUh>(await hsDb.from("hs_uhs").select("id, numero").in("id", uhIds))
        : [];
      return { reservas, quartos, hospedes, uhs };
    },
  });

  const lista = useMemo(() => {
    if (!data) return [];
    const t = busca.trim().toLowerCase();
    return data.reservas
      .filter((r) => situacao === TODAS || r.situacao === situacao)
      .map((r) => {
        const qs = data.quartos
          .filter((q) => q.reserva_id === r.id)
          .sort((a, b) => a.entrada.localeCompare(b.entrada));
        return {
          r,
          titular: data.hospedes.find((h) => h.id === r.titular_id)?.nome ?? "—",
          qs,
          uhs: qs.map((q) => data.uhs.find((u) => u.id === q.uh_id)?.numero ?? "—"),
        };
      })
      .filter(
        (x) =>
          !t || String(x.r.numero) === t.replace(/^#/, "") || x.titular.toLowerCase().includes(t),
      );
  }, [data, busca, situacao]);

  return (
    <div>
      <PageHeader
        title="Reservas"
        description={`${hotel.nome} · as 500 reservas mais recentes.`}
        actions={
          <Button onClick={() => setNova(true)}>
            <Plus className="size-4" /> Nova reserva
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          aria-label="Buscar reserva"
          className="max-w-xs"
          placeholder="Número ou nome do hóspede"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <Select value={situacao} onValueChange={setSituacao}>
          <SelectTrigger aria-label="Situação" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS}>Todas as situações</SelectItem>
            {SITUACOES_RESERVA.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma reserva encontrada"
          description="Crie uma reserva ou mude a busca."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Titular</TableHead>
                <TableHead>Acomodações</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Criada em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map(({ r, titular, qs, uhs }) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => void navegar({ to: "/hotel-estadia/$id", params: { id: r.id } })}
                >
                  <TableCell className="font-medium">
                    <Link
                      to="/hotel-estadia/$id"
                      params={{ id: r.id }}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline"
                    >
                      {r.numero}
                    </Link>
                  </TableCell>
                  <TableCell>{titular}</TableCell>
                  <TableCell>{uhs.join(", ") || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {qs.length > 0
                      ? `${dateBR(qs[0]!.entrada)} a ${dateBR(qs.reduce((m, q) => (q.saida > m ? q.saida : m), qs[0]!.saida))}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <SituacaoBadge situacao={r.situacao} />
                  </TableCell>
                  <TableCell>{rotuloOrigem(r.origem)}</TableCell>
                  <TableCell className="whitespace-nowrap">{dateTimeBR(r.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <NovaReservaDialog
        hotel={hotel}
        aberto={nova}
        onFechar={() => setNova(false)}
        aoCriar={(id) => void navegar({ to: "/hotel-estadia/$id", params: { id } })}
      />
    </div>
  );
}
