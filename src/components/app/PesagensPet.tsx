import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { dateBR, num } from "@/lib/format";
import { evolucaoDasPesagens, type Pesagem } from "@/lib/pet";

const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Histórico e registro de pesagens do pet; avisa o formulário do peso mais recente para ele não ser desfeito ao salvar. */
export function PesagensPet({
  petId,
  podeExcluir,
  aoMudarPeso,
}: {
  petId: string;
  podeExcluir: boolean;
  aoMudarPeso?: (kg: number | null) => void;
}) {
  const qc = useQueryClient();
  const [peso, setPeso] = useState("");
  const [data, setData] = useState("");
  const [obs, setObs] = useState("");

  const lista = useQuery({
    queryKey: ["pet-pesagens", petId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_pesagens")
        .select("id, pet_id, pesado_em, peso_kg, observacao")
        .eq("pet_id", petId)
        .order("pesado_em", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Pesagem[];
    },
  });
  const linhas = evolucaoDasPesagens(lista.data ?? []).reverse();

  const depois = () => {
    void qc.invalidateQueries({ queryKey: ["pet-pesagens", petId] });
    void qc.invalidateQueries({ queryKey: ["pets"] });
  };

  const registrar = useMutation({
    mutationFn: async () => {
      const kg = Number(peso.replace(",", "."));
      if (!Number.isFinite(kg) || kg <= 0 || kg > 200)
        throw new Error("Informe um peso entre 0,01 e 200 kg.");
      const { error } = await supabase.rpc("pet_pesagem_registrar", {
        p_pet_id: petId,
        p_peso_kg: kg,
        ...(data ? { p_data: data } : {}),
        ...(obs.trim() ? { p_observacao: obs.trim() } : {}),
      });
      if (error) throw error;
      return { kg, data: data || hojeLocal() };
    },
    onSuccess: ({ kg, data: dia }) => {
      toast.success("Pesagem registrada.");
      // o peso do cadastro só acompanha a pesagem mais recente
      const maisNova = (lista.data ?? []).every((p) => p.pesado_em <= dia);
      if (maisNova) aoMudarPeso?.(kg);
      setPeso("");
      setData("");
      setObs("");
      depois();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("pet_pesagem_excluir", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pesagem excluída. O peso do cadastro foi recalculado; reabra o pet para ver.");
      depois();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="sm:col-span-2 rounded-md border border-border p-3">
      <p className="mb-2 text-sm font-medium">Pesagens</p>
      <div className="grid gap-2 sm:grid-cols-[7rem_9rem_1fr_auto] sm:items-end">
        <div>
          <Label htmlFor="pes-kg" className="text-xs">
            Peso (kg)
          </Label>
          <Input
            id="pes-kg"
            inputMode="decimal"
            value={peso}
            onChange={(e) => setPeso(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="pes-data" className="text-xs">
            Data (hoje se vazio)
          </Label>
          <Input id="pes-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pes-obs" className="text-xs">
            Observação
          </Label>
          <Input id="pes-obs" value={obs} onChange={(e) => setObs(e.target.value)} />
        </div>
        <Button
          type="button"
          onClick={() => registrar.mutate()}
          disabled={registrar.isPending || !peso.trim()}
        >
          Registrar
        </Button>
      </div>
      {linhas.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nenhuma pesagem registrada.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border text-sm">
          {linhas.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-1">
              <span>
                {dateBR(p.pesado_em)} · <strong>{num(p.peso_kg, 2)} kg</strong>
                {p.variacao !== null && p.variacao !== 0 && (
                  <span className={p.variacao > 0 ? "ml-2 text-amber-700" : "ml-2 text-sky-700"}>
                    {p.variacao > 0 ? "+" : ""}
                    {num(p.variacao, 2)} kg
                  </span>
                )}
                {p.observacao && (
                  <span className="ml-2 text-xs text-muted-foreground">{p.observacao}</span>
                )}
              </span>
              {podeExcluir && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Excluir pesagem"
                  onClick={() => excluir.mutate(p.id)}
                  disabled={excluir.isPending}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
