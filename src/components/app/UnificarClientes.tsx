import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Merge } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ClienteCombobox, type ClienteOpcao } from "@/components/app/ClienteCombobox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const digitos = (v?: string | null) => (v ?? "").replace(/\D/g, "");

/** Junta dois cadastros: pets e histórico vão para o mantido; o duplicado é inativado. */
export function UnificarClientes({ clientes }: { clientes: ClienteOpcao[] }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [manter, setManter] = useState("");
  const [duplicado, setDuplicado] = useState("");

  const repetidos = useMemo(() => {
    const grupos = new Map<string, ClienteOpcao[]>();
    for (const c of clientes) {
      const d = digitos(c.cpf) || digitos(c.cnpj);
      if (!d) continue;
      grupos.set(d, [...(grupos.get(d) ?? []), c]);
    }
    return [...grupos.values()].filter((g) => g.length > 1);
  }, [clientes]);

  const nome = (id: string) => clientes.find((c) => c.id === id)?.nome ?? "";

  const unificar = useMutation({
    mutationFn: async () => {
      if (!manter || !duplicado) throw new Error("Escolha os dois cadastros.");
      if (manter === duplicado) throw new Error("Escolha dois cadastros diferentes.");
      const { data, error } = await supabase.rpc("cliente_unificar", {
        p_manter: manter,
        p_duplicado: duplicado,
      });
      if (error) throw error;
      return data as { pets?: number } | null;
    },
    onSuccess: (r) => {
      toast.success(`Cadastros unificados. ${r?.pets ?? 0} pet(s) transferido(s).`);
      setAberto(false);
      setManter("");
      setDuplicado("");
      for (const k of ["clientes", "pets"]) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button variant="outline" onClick={() => setAberto(true)}>
        <Merge className="mr-2 size-4" /> Unificar cadastros
        {repetidos.length > 0 && (
          <span className="ml-2 rounded-full bg-warning/20 px-2 text-xs text-warning">
            {repetidos.length}
          </span>
        )}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Unificar dois cadastros</DialogTitle>
            <DialogDescription>
              Pets, agenda, pacotes, vendas e contas passam para o cadastro mantido. O duplicado
              fica inativo. Prontuários e documentos já emitidos continuam ligados ao pet.
            </DialogDescription>
          </DialogHeader>
          {repetidos.length > 0 && (
            <div className="rounded-md border border-warning/50 bg-warning/10 p-2 text-xs">
              <p className="font-medium">Mesmo CPF/CNPJ em mais de um cadastro:</p>
              <ul className="mt-1 grid gap-1">
                {repetidos.map((g) => (
                  <li key={g[0]!.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {g[0]!.nome} · {g.length} cadastros
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setManter(g[0]!.id);
                        setDuplicado(g[1]!.id);
                      }}
                    >
                      Usar estes
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-3">
            <div>
              <Label>Cadastro que fica</Label>
              <ClienteCombobox clientes={clientes} value={manter} onChange={setManter} />
            </div>
            <div>
              <Label>Cadastro duplicado (será inativado)</Label>
              <ClienteCombobox
                clientes={clientes.filter((c) => c.id !== manter)}
                value={duplicado}
                onChange={setDuplicado}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!manter || !duplicado || unificar.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Transferir tudo de "${nome(duplicado)}" para "${nome(manter)}" e inativar o duplicado?`,
                  )
                )
                  unificar.mutate();
              }}
            >
              {unificar.isPending ? "Unificando…" : "Unificar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
