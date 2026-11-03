import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { ModuloHotelaria } from "@/components/hotelaria/ModuloHotelaria";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSessionData } from "@/hooks/useSessionData";
import { horaCurta } from "@/lib/hotelaria";
import { hsDb, hsRpc } from "@/lib/hotelaria-api";
import type { Hotel, HsConfig } from "@/lib/hotelaria-tipos";

export const Route = createFileRoute("/_authenticated/hotel-configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações do hotel — EZRA ERP" },
      {
        name: "description",
        content: "Horários de check-in e check-out, taxa de turismo e regras do hotel.",
      },
    ],
  }),
  component: () => <ModuloHotelaria>{(hotel) => <Configuracoes hotel={hotel} />}</ModuloHotelaria>,
});

function Configuracoes({ hotel }: { hotel: Hotel }) {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const gestao = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  const { data, isLoading } = useQuery({
    queryKey: ["hotel-config", hotel.id],
    queryFn: async () => {
      const r = await hsDb.from("hs_config").select("*").eq("filial_id", hotel.id).maybeSingle();
      if (r.error) throw new Error(r.error.message);
      return r.data as HsConfig | null;
    },
  });

  const [checkin, setCheckin] = useState("14:00");
  const [checkout, setCheckout] = useState("12:00");
  const [taxa, setTaxa] = useState("0");
  const [exigeDoc, setExigeDoc] = useState(true);
  const [fuso, setFuso] = useState("America/Sao_Paulo");

  useEffect(() => {
    if (isLoading) return;
    setCheckin(horaCurta(data?.checkin_hora) || "14:00");
    setCheckout(horaCurta(data?.checkout_hora) || "12:00");
    setTaxa(String(data?.taxa_turismo_por_hospede_noite ?? 0));
    setExigeDoc(data?.exige_documento_checkin ?? true);
    setFuso(data?.fuso ?? "America/Sao_Paulo");
  }, [data, isLoading]);

  const salvar = useMutation({
    mutationFn: () =>
      hsRpc("hs_config_salvar", {
        p_filial: hotel.id,
        p_dados: {
          checkin_hora: checkin,
          checkout_hora: checkout,
          taxa_turismo_por_hospede_noite: Number(taxa.replace(",", ".")),
          exige_documento_checkin: exigeDoc,
          fuso,
        },
      }),
    onSuccess: () => {
      toast.success("Configurações salvas.");
      void qc.invalidateQueries({ queryKey: ["hotel-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Configurações do hotel"
        description={`${hotel.nome}. Só a gestão altera.`}
      />
      {isLoading ? (
        <div className="panel h-48 animate-pulse" />
      ) : (
        <div className="panel max-w-xl space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-in" className="mb-1 block text-xs">
                Horário de check-in
              </Label>
              <Input
                id="c-in"
                type="time"
                value={checkin}
                onChange={(e) => setCheckin(e.target.value)}
                disabled={!gestao}
              />
            </div>
            <div>
              <Label htmlFor="c-out" className="mb-1 block text-xs">
                Horário de check-out
              </Label>
              <Input
                id="c-out"
                type="time"
                value={checkout}
                onChange={(e) => setCheckout(e.target.value)}
                disabled={!gestao}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="c-taxa" className="mb-1 block text-xs">
              Taxa de turismo por hóspede e noite (R$)
            </Label>
            <Input
              id="c-taxa"
              inputMode="decimal"
              value={taxa}
              onChange={(e) => setTaxa(e.target.value)}
              disabled={!gestao}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              0 = não cobra. É lançada junto com a diária e fica fora da nota de serviço (repasse ao
              município).
            </p>
          </div>
          <div>
            <Label htmlFor="c-fuso" className="mb-1 block text-xs">
              Fuso horário
            </Label>
            <Input
              id="c-fuso"
              value={fuso}
              onChange={(e) => setFuso(e.target.value)}
              disabled={!gestao}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Define o que é &quot;hoje&quot; para o hotel. Ex.: America/Sao_Paulo, America/Manaus.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={exigeDoc} onCheckedChange={setExigeDoc} disabled={!gestao} /> Exigir o
            documento do titular no check-in
          </label>
          {gestao && (
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
