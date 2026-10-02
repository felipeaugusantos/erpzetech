import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PessoaCodigo = { id: string; nome: string; codigo: string | null };

/**
 * Campo de código (vendedor ou profissional): digita-se o código e o nome
 * encontrado aparece embaixo. Código em branco significa "não informado".
 */
export function CodigoPessoa({
  label,
  codigo,
  onCodigo,
  pessoas,
  onResolver,
  placeholder = "Ex.: 001",
  id,
}: {
  label: string;
  codigo: string;
  onCodigo: (v: string) => void;
  pessoas: PessoaCodigo[];
  onResolver?: (id: string | null) => void;
  placeholder?: string;
  id?: string;
}) {
  const alvo = codigo.trim().toLowerCase();
  const achado = alvo
    ? (pessoas.find((p) => (p.codigo ?? "").trim().toLowerCase() === alvo) ?? null)
    : null;

  function mudar(v: string) {
    onCodigo(v);
    const t = v.trim().toLowerCase();
    const p = t ? (pessoas.find((x) => (x.codigo ?? "").trim().toLowerCase() === t) ?? null) : null;
    onResolver?.(p?.id ?? null);
  }

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={codigo}
        onChange={(e) => mudar(e.target.value)}
        placeholder={placeholder}
      />
      <p className="mt-1 h-4 text-xs">
        {!alvo ? (
          <span className="text-muted-foreground">Opcional</span>
        ) : achado ? (
          <span className="font-medium text-primary">{achado.nome}</span>
        ) : (
          <span className="text-destructive">Código não encontrado</span>
        )}
      </p>
    </div>
  );
}
