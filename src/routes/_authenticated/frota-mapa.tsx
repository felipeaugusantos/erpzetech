import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/frota-mapa")({
  head: () => ({
    meta: [
      { title: "Onde estão os caminhões — ERP Ze Tech" },
      { name: "description", content: "Última posição enviada pelo celular de cada motorista." },
    ],
  }),
  component: FrotaMapa,
});

const minutos = (iso: string) => Math.round((Date.now() - new Date(iso).getTime()) / 60000);

function FrotaMapa() {
  const [sel, setSel] = useState<string | null>(null);
  const { data = [], isLoading } = useQuery({
    queryKey: ["frota-posicoes"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("motoristas")
        .select("id, nome, ultima_lat, ultima_lng, ultima_posicao_em")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });
  const comPos = data.filter((m) => m.ultima_lat != null && m.ultima_lng != null);
  const atual = comPos.find((m) => m.id === sel) ?? comPos[0];

  return (
    <>
      <PageHeader
        title="Onde estão os caminhões"
        description="O celular de cada motorista envia a posição a cada minuto enquanto o app está aberto. A tela se atualiza sozinha."
      />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="panel divide-y divide-border p-0">
          {data.map((m) => {
            const tem = m.ultima_lat != null && m.ultima_posicao_em;
            const min = tem ? minutos(m.ultima_posicao_em!) : null;
            return (
              <button
                key={m.id}
                disabled={!tem}
                onClick={() => setSel(m.id)}
                className={`block w-full px-3 py-2 text-left text-sm disabled:opacity-60 ${atual?.id === m.id ? "bg-secondary" : ""}`}
              >
                <span className="font-medium">{m.nome}</span>
                <p
                  className={`text-xs ${min != null && min > 10 ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {min == null
                    ? "Ainda não enviou posição"
                    : min < 1
                      ? "Agora há pouco"
                      : `Há ${min} min${min > 10 ? " — sinal parado" : ""}`}
                </p>
              </button>
            );
          })}
          {isLoading && <p className="p-3 text-sm text-muted-foreground">Carregando…</p>}
        </div>
        <div className="panel overflow-hidden p-0">
          {atual ? (
            <>
              <iframe
                title="Posição do caminhão"
                className="h-[480px] w-full border-0"
                referrerPolicy="no-referrer"
                src={`https://maps.google.com/maps?q=${atual.ultima_lat},${atual.ultima_lng}&z=15&output=embed`}
              />
              <div className="flex items-center gap-2 p-3 text-sm">
                {atual.nome}
                <Button size="sm" className="ml-auto" asChild>
                  <a
                    href={`https://www.google.com/maps?q=${atual.ultima_lat},${atual.ultima_lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir no Google Maps
                  </a>
                </Button>
              </div>
            </>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              Nenhum motorista enviou posição ainda. A posição aparece quando ele abre o app do
              motorista no celular e permite a localização.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
