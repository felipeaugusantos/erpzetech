import { useState } from "react";
import { Navigation } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Mapa da próxima parada e link da rota completa (abre o GPS do celular a partir de onde ele está). */
export function MapaRota({ paradas }: { paradas: { rotulo: string; endereco: string }[] }) {
  const validas = paradas.filter((p) => p.endereco && p.endereco !== "—");
  const [sel, setSel] = useState(0);
  if (validas.length === 0) return null;
  const atual = validas[Math.min(sel, validas.length - 1)];
  const destino = validas[validas.length - 1].endereco;
  const meio = validas.slice(0, -1).map((p) => p.endereco).join("|");
  const rota =
    `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(destino)}` +
    (meio ? `&waypoints=${encodeURIComponent(meio)}` : "");

  return (
    <section className="panel mb-4 overflow-hidden p-0">
      <iframe
        title="Mapa da entrega"
        className="h-64 w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={`https://maps.google.com/maps?q=${encodeURIComponent(atual.endereco)}&z=15&output=embed`}
      />
      <div className="flex flex-wrap gap-2 p-3">
        {validas.map((p, i) => (
          <Button
            key={i}
            size="sm"
            variant={i === sel ? "default" : "outline"}
            onClick={() => setSel(i)}
          >
            {i + 1}. {p.rotulo}
          </Button>
        ))}
        <Button size="sm" className="ml-auto" asChild>
          <a href={rota} target="_blank" rel="noreferrer">
            <Navigation className="mr-1 size-4" /> Iniciar rota no GPS
          </a>
        </Button>
      </div>
    </section>
  );
}
