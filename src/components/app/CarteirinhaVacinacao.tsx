import { CalendarClock, PawPrint, Syringe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { dateBR } from "@/lib/format";
import { ESPECIES, idadeDoPet, rotulo } from "@/lib/pet";
import { diasAte, rotuloDose, type CartaoVacinacao } from "@/lib/vacinas";

export function CarteirinhaVacinacao({
  cartao: c,
  hoje,
}: {
  cartao: CartaoVacinacao;
  hoje: string;
}) {
  const proximas = [...c.proximas].sort((a, b) =>
    a.proxima_dose_em.localeCompare(b.proxima_dose_em),
  );
  return (
    <article
      id="documento-impresso"
      className="carteirinha-vacinacao mx-auto w-full max-w-5xl bg-card text-card-foreground"
    >
      <header className="border-b-2 border-primary px-4 py-5 sm:px-6">
        <p className="text-sm font-semibold text-primary">{c.clinica ?? "Clínica veterinária"}</p>
        <h2 className="mt-1 font-display text-2xl font-semibold">Carteirinha de vacinação</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Vacinas e vermifugação · Emitida em {dateBR(hoje)}
        </p>
      </header>
      <section
        aria-label="Identificação do paciente"
        className="grid gap-4 border-b border-border px-4 py-5 sm:grid-cols-2 sm:px-6"
      >
        <div className="flex min-w-0 items-start gap-3">
          <PawPrint className="mt-1 size-7 shrink-0 text-primary" />
          <div className="min-w-0">
            <h3 className="break-words font-display text-xl font-semibold">{c.pet.nome}</h3>
            <p className="break-words text-sm text-muted-foreground">
              {rotulo(ESPECIES, c.pet.especie)}
              {c.pet.raca ? ` · ${c.pet.raca}` : ""}
            </p>
            <p className="mt-1 text-sm">
              Nascimento:{" "}
              {c.pet.nascimento
                ? `${dateBR(c.pet.nascimento)} · ${idadeDoPet(c.pet.nascimento)}`
                : "Não informado"}
            </p>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Tutor(a)</p>
          <p className="break-words font-semibold">{c.tutor}</p>
          <p className="mt-1 text-sm">
            Sexo:{" "}
            {c.pet.sexo === "macho" ? "Macho" : c.pet.sexo === "femea" ? "Fêmea" : "Não informado"}
          </p>
        </div>
      </section>
      <section aria-label="Próximas doses e reforços" className="px-4 py-5 sm:px-6">
        <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
          <CalendarClock className="size-5 text-primary" /> Próximas doses e reforços
        </h3>
        {proximas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma próxima dose registrada.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {proximas.map((p, index) => {
              const dias = diasAte(p.proxima_dose_em, hoje);
              return (
                <li
                  key={`${p.nome}-${index}`}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="break-words font-semibold">{p.nome}</p>
                    <p className="text-muted-foreground">
                      {p.tipo === "vermifugo" ? "Vermifugação" : "Vacinação"} ·{" "}
                      {dateBR(p.proxima_dose_em)}
                    </p>
                  </div>
                  <Badge variant={dias < 0 ? "destructive" : "secondary"}>
                    {dias < 0
                      ? `${Math.abs(dias)} dia(s) em atraso`
                      : dias === 0
                        ? "Prevista para hoje"
                        : `Em ${dias} dia(s)`}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section aria-label="Doses aplicadas" className="px-4 pb-5 sm:px-6">
        <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
          <Syringe className="size-5 text-primary" /> Doses aplicadas{" "}
          <span className="text-sm font-normal text-muted-foreground">({c.aplicacoes.length})</span>
        </h3>
        {c.aplicacoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma aplicação registrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="carteirinha-doses w-full table-fixed border-collapse text-left text-sm">
              <thead>
                <tr className="border-y border-border bg-muted">
                  <th className="w-[22%] p-2">Vacina / dose</th>
                  <th className="w-[15%] p-2">Aplicação</th>
                  <th className="w-[18%] p-2">Lote / validade</th>
                  <th className="w-[25%] p-2">Responsável / origem</th>
                  <th className="w-[20%] p-2">Próxima dose</th>
                </tr>
              </thead>
              <tbody>
                {c.aplicacoes.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b border-border align-top [&_td]:break-words [&_td]:p-2"
                  >
                    <td data-label="Vacina / dose">
                      <strong>{a.nome}</strong>
                      <span className="block text-xs text-muted-foreground">
                        {rotuloDose(a.dose_tipo, a.dose_numero)}
                      </span>
                    </td>
                    <td data-label="Aplicação">{dateBR(a.aplicada_em)}</td>
                    <td data-label="Lote / validade">
                      {a.lote ?? "Não informado"}
                      <span className="block text-xs text-muted-foreground">
                        {a.validade_lote
                          ? `Validade ${dateBR(a.validade_lote)}`
                          : "Validade não informada"}
                      </span>
                    </td>
                    <td data-label="Responsável / origem">
                      {a.origem === "outro_local" ? (
                        <>
                          <span>Aplicada em outro local</span>
                          <span className="block text-xs text-muted-foreground">
                            Informado por {a.informado_por ?? "Não informado"}
                          </span>
                        </>
                      ) : (
                        <>
                          <span>{a.aplicador ?? a.veterinario ?? "Não informado"}</span>
                          <span className="block text-xs text-muted-foreground">
                            Resp.: {a.veterinario ?? "Não informado"}
                            {a.crmv ? ` · CRMV ${a.crmv}/${a.crmv_uf ?? "—"}` : ""}
                          </span>
                        </>
                      )}
                    </td>
                    <td data-label="Próxima dose">
                      {a.proxima_dose_em ? (
                        <>
                          {dateBR(a.proxima_dose_em)}
                          <span className="block text-xs text-muted-foreground">
                            Intervalo: {diasAte(a.proxima_dose_em, a.aplicada_em)} dias
                          </span>
                        </>
                      ) : (
                        "Sem próxima dose"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <footer className="border-t border-border px-4 py-4 text-xs text-muted-foreground sm:px-6">
        Datas previstas conforme os registros da clínica. Aplicações informadas por terceiros estão
        identificadas na origem. Esta carteirinha não contém informações clínicas das consultas.
      </footer>
    </article>
  );
}
