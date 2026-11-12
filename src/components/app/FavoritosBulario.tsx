import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { situacaoValidade, type FavoritoBulario } from "@/lib/bulario-favoritos";
import { dateBR } from "@/lib/format";
import { isoBrasilia } from "@/lib/fuso";

const CHAVE = ["bulario-favoritos"];

export function useFavoritosBulario(enabled = true) {
  return useQuery({
    queryKey: CHAVE,
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("bulario_favoritos");
      if (error) throw error;
      return (data ?? []) as unknown as FavoritoBulario[];
    },
  });
}

export function BadgeValidade({ validade }: { validade: string | null }) {
  const s = situacaoValidade(validade, isoBrasilia());
  if (s === "sem_validade") return null;
  if (s === "vencido") return <Badge variant="destructive">Vencido em {dateBR(validade)}</Badge>;
  if (s === "vence_logo")
    return (
      <Badge variant="outline" className="border-warning text-warning">
        Vence em {dateBR(validade)}
      </Badge>
    );
  return <Badge variant="secondary">Validade {dateBR(validade)}</Badge>;
}

/** Botão de favoritar na ficha do bulário, com a dose de costume e a validade. */
export function BotaoFavoritoBulario({ medicamentoId }: { medicamentoId: string }) {
  const qc = useQueryClient();
  const { data: favoritos = [] } = useFavoritosBulario();
  const atual = favoritos.find((f) => f.medicamento_id === medicamentoId);
  const [aberto, setAberto] = useState(false);
  const [dose, setDose] = useState("");
  const [validade, setValidade] = useState("");

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("bulario_favorito_salvar", {
        p_id: medicamentoId,
        p_dose: dose,
        p_validade: (validade || null) as string,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Favorito salvo");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remover = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("bulario_favorito_remover", { p_id: medicamentoId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido dos favoritos");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button
        variant={atual ? "secondary" : "outline"}
        size="sm"
        onClick={() => {
          setDose(atual?.dose ?? "");
          setValidade(atual?.validade ?? "");
          setAberto(true);
        }}
      >
        <Star className={atual ? "fill-current text-warning" : ""} />
        {atual ? "Favorito" : "Favoritar"}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remédio favorito</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="fav-dose">Dose de costume</Label>
              <Textarea
                id="fav-dose"
                rows={3}
                maxLength={2000}
                value={dose}
                onChange={(e) => setDose(e.target.value)}
                placeholder="Ex.: 0,2 mg/kg a cada 24 h por 5 dias"
              />
            </div>
            <div>
              <Label htmlFor="fav-validade">Validade</Label>
              <Input
                id="fav-validade"
                type="date"
                value={validade}
                onChange={(e) => setValidade(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Anotação da clínica para consulta. Não preenche receita nem estoque.
            </p>
          </div>
          <DialogFooter className="gap-2">
            {atual && (
              <Button
                variant="outline"
                onClick={() => remover.mutate()}
                disabled={remover.isPending}
              >
                Remover dos favoritos
              </Button>
            )}
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Lista dos remédios favoritos da clínica, para consultar no prontuário e no bulário. */
export function ListaFavoritosBulario({ titulo = "Remédios favoritos" }: { titulo?: string }) {
  const { data = [], isLoading, isError } = useFavoritosBulario();
  if (isError) return null;
  return (
    <div className="panel p-4">
      <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold">
        <Star className="size-4 fill-current text-warning" /> {titulo}
      </h3>
      {isLoading ? (
        <div className="h-12 animate-pulse rounded bg-muted" />
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum favorito ainda. Abra um remédio no{" "}
          <Link to="/clinica-bulario" className="text-primary underline">
            Bulário
          </Link>{" "}
          e toque em Favoritar.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {data.map((f) => (
            <li key={f.medicamento_id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  to="/clinica-bulario/$id"
                  params={{ id: f.medicamento_id }}
                  className="font-medium hover:underline"
                >
                  {f.nome}
                </Link>
                <BadgeValidade validade={f.validade} />
              </div>
              {f.principio_ativo && (
                <p className="text-xs text-muted-foreground">{f.principio_ativo}</p>
              )}
              {f.dose && <p className="mt-1 whitespace-pre-wrap">{f.dose}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
