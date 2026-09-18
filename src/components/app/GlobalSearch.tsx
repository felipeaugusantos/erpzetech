import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HardHat, PackageSearch, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export function GlobalSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const { data } = useQuery({
    queryKey: ["global-search", debounced],
    enabled: open && debounced.length >= 2,
    queryFn: async () => {
      const like = `%${debounced}%`;
      const [clientes, produtos, obras] = await Promise.all([
        supabase
          .from("clientes")
          .select("id, nome, cpf, cnpj, telefone")
          .or(`nome.ilike.${like},cpf.ilike.${like},cnpj.ilike.${like},telefone.ilike.${like}`)
          .limit(5),
        supabase
          .from("produtos")
          .select("id, descricao, codigo_interno, codigo_barras")
          .or(
            `descricao.ilike.${like},codigo_interno.ilike.${like},codigo_barras.ilike.${like}`,
          )
          .limit(5),
        supabase.from("obras").select("id, nome").ilike("nome", like).limit(5),
      ]);
      return {
        clientes: clientes.data ?? [],
        produtos: produtos.data ?? [],
        obras: obras.data ?? [],
      };
    },
  });

  function go(to: string) {
    onOpenChange(false);
    setTerm("");
    navigate({ to });
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Cliente, CPF/CNPJ, produto, código de barras, obra…"
        value={term}
        onValueChange={setTerm}
      />
      <CommandList>
        {debounced.length < 2 ? (
          <CommandEmpty>Digite ao menos 2 caracteres.</CommandEmpty>
        ) : (
          <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
        )}
        {!!data?.clientes.length && (
          <CommandGroup heading="Clientes">
            {data.clientes.map((c) => (
              <CommandItem key={c.id} value={`cli-${c.id}-${c.nome}`} onSelect={() => go("/clientes")}>
                <Users className="mr-2 size-4" />
                {c.nome}
                <span className="ml-auto text-xs text-muted-foreground">
                  {c.cpf || c.cnpj || c.telefone}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!data?.produtos.length && (
          <CommandGroup heading="Produtos">
            {data.produtos.map((p) => (
              <CommandItem
                key={p.id}
                value={`prod-${p.id}-${p.descricao}`}
                onSelect={() => go("/produtos")}
              >
                <PackageSearch className="mr-2 size-4" />
                {p.descricao}
                <span className="ml-auto text-xs text-muted-foreground">{p.codigo_interno}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!data?.obras.length && (
          <CommandGroup heading="Obras">
            {data.obras.map((o) => (
              <CommandItem key={o.id} value={`obra-${o.id}-${o.nome}`} onSelect={() => go("/obras")}>
                <HardHat className="mr-2 size-4" />
                {o.nome}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
