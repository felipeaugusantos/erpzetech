import { linhasDaCorrecao, type AdendoClinico } from "@/lib/clinica";

const valor = (v: string | null) =>
  v === null || v === "" ? "vazio" : v.replace(/^(-?\d+)\.(\d+)$/, "$1,$2");

/** Mostra, numa correção de atendimento, o que estava registrado antes e o que ficou depois. */
export function CorrecaoDoAdendo({ adendo }: { adendo: AdendoClinico }) {
  const linhas = linhasDaCorrecao(adendo);
  if (linhas.length === 0) return null;
  return (
    <dl className="mt-2 grid gap-1 text-xs">
      {linhas.map((l) => (
        <div key={l.rotulo}>
          <dt className="font-semibold">{l.rotulo}</dt>
          <dd className="whitespace-pre-wrap break-words text-muted-foreground">
            Antes: {valor(l.antes)}
          </dd>
          <dd className="whitespace-pre-wrap break-words">Depois: {valor(l.depois)}</dd>
        </div>
      ))}
    </dl>
  );
}
