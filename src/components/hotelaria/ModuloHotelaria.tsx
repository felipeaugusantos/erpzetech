import type { ReactNode } from "react";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState } from "@/components/app/PageHeader";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHotel } from "@/hooks/useHotel";
import { useModulosCnae } from "@/lib/cnae";
import type { Hotel } from "@/lib/hotelaria-tipos";

/** Envolve as telas da Hotelaria: confere o módulo, escolhe o hotel (filial) e entrega o hotel em uso. */
export function ModuloHotelaria({ children }: { children: (hotel: Hotel) => ReactNode }) {
  const modulos = useModulosCnae();
  const { carregando, hoteis, hotel, escolher } = useHotel();
  if (modulos.carregando || carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.hotelaria) return <ModuloBloqueado modulo="hotelaria" />;
  if (!hotel) {
    return (
      <EmptyState
        title="Nenhum hotel disponível"
        description="Cada hotel é uma filial da empresa. Cadastre a filial em Empresa ou peça acesso ao administrador."
      />
    );
  }
  return (
    <div>
      {hoteis.length > 1 && (
        <div className="mb-4 flex items-center gap-2">
          <Label htmlFor="hotel-escolhido" className="text-sm text-muted-foreground">
            Hotel
          </Label>
          <Select value={hotel.id} onValueChange={escolher}>
            <SelectTrigger id="hotel-escolhido" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hoteis.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {children(hotel)}
    </div>
  );
}
