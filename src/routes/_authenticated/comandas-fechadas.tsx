import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";

import { EmitirNfce } from "@/components/app/EmitirNfce";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSessionData } from "@/hooks/useSessionData";
import { useModulosCnae } from "@/lib/cnae";
import { intervaloDias, notaPorComanda, rotuloNota } from "@/lib/comandas-fechadas";
import { brl, dateTimeBR } from "@/lib/format";
import { hojeISO } from "@/lib/financeiro";
import { recebeConta } from "@/lib/restaurante";
import { CHAVE_REST, tabela, type Comanda, type Mesa } from "@/lib/restaurante-dados";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/comandas-fechadas")({
  head: () => ({
    meta: [
      { title: "Comandas fechadas — ERP Ze Tech" },
      { name: "description", content: "Contas já fechadas do restaurante e a NFC-e de cada uma." },
      { property: "og:title", content: "Comandas fechadas — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Contas já fechadas do restaurante e a NFC-e de cada uma.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ComandasFechadas,
});

const LIMITE = 300;

function ComandasFechadas() {
  const { data: session } = useSessionData();
  const modulos = useModulosCnae();
  const roles = session?.roles ?? [];
  const [de, setDe] = useState(hojeISO);
  const [ate, setAte] = useState(hojeISO);
  const [emitindo, setEmitindo] = useState<Comanda | null>(null);
  const periodo = intervaloDias(de, ate);

  const { data, isLoading } = useQuery({
    queryKey: [CHAVE_REST, "fechadas", periodo?.inicio, periodo?.fim],
    queryFn: async () => {
      if (!periodo) return { comandas: [], mesas: [], notas: [] };
      const [comandas, mesas] = await Promise.all([
        tabela("comandas")
          .select("*")
          .eq("situacao", "fechada")
          .gte("fechada_em", periodo.inicio)
          .lt("fechada_em", periodo.fim)
          .order("fechada_em", { ascending: false })
          .limit(LIMITE),
        tabela("mesas").select("id, numero"),
      ]);
      if (comandas.error) throw new Error(comandas.error.message);
      if (mesas.error) throw new Error(mesas.error.message);
      const lista = (comandas.data ?? []) as unknown as Comanda[];
      let notas: {
        comanda_id: string | null;
        situacao: string;
        numero: number | null;
        created_at: string;
      }[] = [];
      if (lista.length > 0) {
        const r = await supabase
          .from("nfe")
          .select("comanda_id, situacao, numero, created_at")
          .eq("modelo", "nfce")
          .in(
            "comanda_id",
            lista.map((c) => c.id),
          );
        if (r.error) throw new Error(r.error.message);
        notas = r.data ?? [];
      }
      return {
        comandas: lista,
        mesas: (mesas.data ?? []) as unknown as Pick<Mesa, "id" | "numero">[],
        notas,
      };
    },
    enabled: modulos.restaurante && !!periodo,
  });

  if (session && !modulos.carregando && !modulos.restaurante)
    return <ModuloBloqueado modulo="restaurante" />;
  if (session && !recebeConta(roles))
    return (
      <EmptyState
        title="Sem acesso às comandas fechadas"
        description="Só o caixa e a gestão emitem nota das contas fechadas."
      />
    );

  const notas = notaPorComanda(data?.notas ?? []);
  const mesaNumero = new Map((data?.mesas ?? []).map((m) => [m.id, m.numero]));
  const lista = data?.comandas ?? [];

  return (
    <>
      <PageHeader
        title="Comandas fechadas"
        description="Contas já recebidas do salão e do delivery. Emita ou confira a NFC-e de cada uma."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="cf-de">De</Label>
          <Input
            id="cf-de"
            type="date"
            className="mt-1"
            value={de}
            max={ate}
            onChange={(e) => setDe(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="cf-ate">Até</Label>
          <Input
            id="cf-ate"
            type="date"
            className="mt-1"
            value={ate}
            min={de}
            onChange={(e) => setAte(e.target.value)}
          />
        </div>
      </div>

      {!periodo ? (
        <p className="text-sm text-destructive">
          Período inválido: a data final não pode vir antes da inicial.
        </p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma comanda fechada"
          description="Não há contas fechadas neste período."
        />
      ) : (
        <>
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Comanda</TableHead>
                  <TableHead>Mesa / tipo</TableHead>
                  <TableHead>Fechada em</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>NFC-e</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((c) => {
                  const nota = notas.get(c.id);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {c.numero}
                        {c.cliente_nome ? (
                          <span className="ml-2 text-muted-foreground">{c.cliente_nome}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {c.tipo === "delivery"
                          ? "Delivery"
                          : c.mesa_id
                            ? `Mesa ${mesaNumero.get(c.mesa_id) ?? "—"}`
                            : "Avulsa"}
                      </TableCell>
                      <TableCell>{dateTimeBR(c.fechada_em)}</TableCell>
                      <TableCell className="text-right">{brl(Number(c.total))}</TableCell>
                      <TableCell>
                        <Badge variant={nota ? "secondary" : "outline"}>{rotuloNota(nota)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setEmitindo(c)}>
                          <FileText className="mr-1 h-4 w-4" />
                          {nota ? "Ver NFC-e" : "Emitir NFC-e"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {lista.length >= LIMITE ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Mostrando as {LIMITE} mais recentes do período; reduza as datas para ver as demais.
            </p>
          ) : null}
        </>
      )}

      <Dialog open={!!emitindo} onOpenChange={(o) => !o && setEmitindo(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>NFC-e da comanda {emitindo?.numero}</DialogTitle>
          </DialogHeader>
          {emitindo ? <EmitirNfce comandaId={emitindo.id} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
