import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useCategoriasFinanceiras } from "@/hooks/useCategoriasFinanceiras";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TipoCategoria } from "@/lib/categorias-financeiras";

const NENHUMA = "__nenhuma";

/** Escolha da categoria de um lançamento. Valor vazio = sem categoria. */
export function SeletorCategoria({
  tipo,
  valor,
  onChange,
}: {
  tipo: TipoCategoria;
  valor: string;
  onChange: (id: string) => void;
}) {
  const { data: categorias = [], isLoading } = useCategoriasFinanceiras(tipo);
  if (!isLoading && categorias.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
        Nenhuma categoria cadastrada.{" "}
        <Link to="/financeiro-categorias" className="underline">
          Cadastrar categorias
        </Link>
      </p>
    );
  }
  return (
    <Select value={valor || NENHUMA} onValueChange={(v) => onChange(v === NENHUMA ? "" : v)}>
      <SelectTrigger>
        <SelectValue placeholder="Sem categoria" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NENHUMA}>Sem categoria</SelectItem>
        {categorias.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export type TituloCategoria = {
  id: string;
  numero: number | null;
  categoria_id: string | null;
};

/** Troca a categoria de um título já lançado (o banco confere empresa e tipo). */
export function AlterarCategoriaTitulo({
  tipo,
  titulo,
  onOpenChange,
}: {
  tipo: TipoCategoria;
  titulo: TituloCategoria | null;
  onOpenChange: (aberto: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const atual = escolhida ?? titulo?.categoria_id ?? "";
  const tabela = tipo === "receita" ? "contas_receber" : "contas_pagar";

  const salvar = useMutation({
    mutationFn: async () => {
      if (!titulo) return;
      const { error } = await supabase
        .from(tabela)
        .update({ categoria_id: atual || null })
        .eq("id", titulo.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Categoria atualizada.");
      void queryClient.invalidateQueries({
        queryKey: [tipo === "receita" ? "contas-receber" : "contas-pagar"],
      });
      setEscolhida(null);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={Boolean(titulo)}
      onOpenChange={(aberto) => {
        if (!aberto) setEscolhida(null);
        onOpenChange(aberto);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Categoria do título nº {titulo?.numero}</DialogTitle>
          <DialogDescription>
            A categoria define onde o lançamento aparece no DRE. Trocar não altera valor nem
            pagamentos.
          </DialogDescription>
        </DialogHeader>
        <SeletorCategoria tipo={tipo} valor={atual} onChange={setEscolhida} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
