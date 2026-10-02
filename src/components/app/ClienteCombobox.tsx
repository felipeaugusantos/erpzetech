import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ClienteOpcao = {
  id: string;
  nome: string;
  cpf?: string | null;
  cnpj?: string | null;
  telefone?: string | null;
};

/**
 * Campo de cliente com digitação: o usuário escreve o nome (ou CPF/CNPJ/telefone)
 * e escolhe na lista filtrada. Use `balcaoValue` para oferecer "Consumidor final".
 */
export function ClienteCombobox({
  clientes,
  value,
  onChange,
  balcaoValue,
  balcaoLabel = "Consumidor final (balcão)",
  placeholder = "Digite o nome do cliente…",
  disabled,
  className,
}: {
  clientes: ClienteOpcao[];
  value: string;
  onChange: (id: string) => void;
  balcaoValue?: string;
  balcaoLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const selecionado = useMemo(
    () => clientes.find((c) => c.id === value) ?? null,
    [clientes, value],
  );

  const rotulo =
    balcaoValue !== undefined && value === balcaoValue ? balcaoLabel : (selecionado?.nome ?? "");

  function escolher(id: string) {
    onChange(id);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", !rotulo && "text-muted-foreground")}>
            {rotulo || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,90vw)] p-0" align="start">
        <Command
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Nome, CPF/CNPJ ou telefone…" />
          <CommandList>
            <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
            <CommandGroup>
              {balcaoValue !== undefined && (
                <CommandItem value={balcaoLabel} onSelect={() => escolher(balcaoValue)}>
                  <UserRound className="mr-2 size-4" />
                  {balcaoLabel}
                  {value === balcaoValue && <Check className="ml-auto size-4" />}
                </CommandItem>
              )}
              {clientes.map((c) => (
                <CommandItem
                  key={c.id}
                  value={[c.nome, c.cpf, c.cnpj, c.telefone].filter(Boolean).join(" ")}
                  onSelect={() => escolher(c.id)}
                >
                  <span className="truncate">{c.nome}</span>
                  <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                    {c.cpf || c.cnpj || c.telefone || ""}
                    {value === c.id && <Check className="size-4 text-primary" />}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
