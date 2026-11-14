import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, HardHat, PackageSearch, PawPrint, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { filtrarTelas, type TelaBusca } from "@/lib/busca-telas";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

/** Tira caracteres que quebram o filtro "or" da consulta. */
const limpar = (t: string) => t.replace(/[%,()*]/g, " ").trim();

export function GlobalSearch({
  open,
  onOpenChange,
  telas = [],
  veClinica = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  telas?: TelaBusca[];
  veClinica?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(limpar(term)), 250);
    return () => clearTimeout(t);
  }, [term]);

  const telasAchadas = useMemo(() => filtrarTelas(telas, term), [telas, term]);
  const pode = (to: string) => telas.some((t) => t.to === to);

  const { data } = useQuery({
    queryKey: ["global-search", debounced, veClinica],
    enabled: open && debounced.length >= 2,
    queryFn: async () => {
      const like = `%${debounced}%`;
      const [clientes, produtos, obras, pets] = await Promise.all([
        supabase
          .from("clientes")
          .select("id, nome, cpf, cnpj, telefone")
          .or(`nome.ilike.${like},cpf.ilike.${like},cnpj.ilike.${like},telefone.ilike.${like}`)
          .limit(5),
        supabase
          .from("produtos")
          .select("id, descricao, codigo_interno, codigo_barras, preco_venda, unidade")
          .or(`descricao.ilike.${like},codigo_interno.ilike.${like},codigo_barras.ilike.${like}`)
          .limit(5),
        supabase.from("obras").select("id, nome").ilike("nome", like).limit(5),
        veClinica
          ? supabase.from("pets").select("id, nome, especie").ilike("nome", like).limit(5)
          : Promise.resolve({ data: [] as { id: string; nome: string; especie: string }[] }),
      ]);
      return {
        clientes: clientes.data ?? [],
        produtos: produtos.data ?? [],
        obras: obras.data ?? [],
        pets: pets.data ?? [],
      };
    },
  });

  function fechar() {
    onOpenChange(false);
    setTerm("");
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Tela, cliente, CPF/CNPJ, produto, código de barras, pet…"
        value={term}
        onValueChange={setTerm}
      />
      <CommandList>
        <CommandEmpty>
          {term.trim().length < 2 ? "Digite ao menos 2 caracteres." : "Nenhum resultado encontrado."}
        </CommandEmpty>
        {telasAchadas.length > 0 && (
          <CommandGroup heading="Ir para a tela">
            {telasAchadas.map((t) => (
              <CommandItem
                key={t.to}
                value={`tela-${t.to}-${t.label}`}
                onSelect={() => {
                  fechar();
                  navigate({ to: t.to });
                }}
              >
                <ArrowRight className="mr-2 size-4" />
                {t.label}
                <span className="ml-auto text-xs text-muted-foreground">{t.grupo}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!data?.clientes.length && (
          <CommandGroup heading="Clientes">
            {data.clientes.map((c) => (
              <CommandItem
                key={c.id}
                value={`cli-${c.id}-${c.nome}`}
                onSelect={() => {
                  fechar();
                  navigate({ to: "/clientes", search: { editar: c.id } });
                }}
              >
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
                onSelect={() => {
                  fechar();
                  navigate({ to: "/produtos" });
                }}
              >
                <PackageSearch className="mr-2 size-4" />
                <span className="truncate">{p.descricao}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {p.codigo_interno ? `${p.codigo_interno} · ` : ""}
                  {brl(Number(p.preco_venda ?? 0))}
                  {p.unidade ? `/${p.unidade}` : ""}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!data?.pets.length && (
          <CommandGroup heading="Pets">
            {data.pets.map((p) => (
              <CommandItem
                key={p.id}
                value={`pet-${p.id}-${p.nome}`}
                onSelect={() => {
                  fechar();
                  if (pode("/clinica-prontuario"))
                    navigate({ to: "/clinica-prontuario", search: { pet: p.id } });
                  else navigate({ to: "/pets" });
                }}
              >
                <PawPrint className="mr-2 size-4" />
                {p.nome}
                <span className="ml-auto text-xs text-muted-foreground">{p.especie}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!data?.obras.length && (
          <CommandGroup heading="Obras">
            {data.obras.map((o) => (
              <CommandItem
                key={o.id}
                value={`obra-${o.id}-${o.nome}`}
                onSelect={() => {
                  fechar();
                  navigate({ to: "/obras" });
                }}
              >
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
