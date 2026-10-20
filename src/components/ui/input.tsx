import * as React from "react";

import { aplicarMascara, type TipoMascara } from "@/lib/mascaras";
import { cn } from "@/lib/utils";

type InputProps = React.ComponentProps<"input"> & {
  /** Formata o que é digitado ou colado (telefone, CPF, CNPJ, CPF ou CNPJ, CEP); quem lê `onChange` já recebe o texto formatado. */
  mascara?: TipoMascara;
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, mascara, value, onChange, ...props }, ref) => {
    const comMascara = mascara
      ? {
          // mostra formatado até o que já estava gravado sem pontuação
          ...(typeof value === "string" ? { value: aplicarMascara(mascara, value) } : {}),
          // CNPJ pode ter letras (alfanumérico): sem teclado só numérico
          inputMode:
            mascara === "telefone"
              ? ("tel" as const)
              : mascara === "cnpj" || mascara === "cpfcnpj"
                ? ("text" as const)
                : ("numeric" as const),
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            e.target.value = aplicarMascara(mascara, e.target.value);
            onChange?.(e);
          },
        }
      : { ...(value !== undefined ? { value } : {}), ...(onChange ? { onChange } : {}) };
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
        {...comMascara}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
