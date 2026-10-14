import { useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";

import { Input } from "@/components/ui/input";

/**
 * Campo de leitura de código de barras: o leitor digita o código e dá Enter. `aoLer` devolve o que
 * aconteceu (confere, passou do limite, código desconhecido) e o resultado fica na tela.
 */
export function LeitorPedido({
  aoLer,
  placeholder = "Bipe o código de barras (ex.: 3*código para 3 unidades)",
  autoFocus = false,
}: {
  aoLer: (texto: string) => { ok: boolean; texto: string };
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [leitura, setLeitura] = useState("");
  const [ultimo, setUltimo] = useState<{ ok: boolean; texto: string } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-1">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const texto = leitura.trim();
          if (!texto) return;
          const r = aoLer(texto);
          if (r.texto) setUltimo(r);
          setLeitura("");
          ref.current?.focus();
        }}
      >
        <div className="relative">
          <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={ref}
            autoFocus={autoFocus}
            className="h-11 pl-10"
            placeholder={placeholder}
            aria-label="Leitor de código de barras"
            value={leitura}
            onChange={(e) => setLeitura(e.target.value)}
          />
        </div>
      </form>
      {ultimo && (
        <p
          role="status"
          className={`text-sm font-medium ${ultimo.ok ? "text-success" : "text-destructive"}`}
        >
          {ultimo.ok ? "✓ " : "✗ "}
          {ultimo.texto}
        </p>
      )}
    </div>
  );
}
