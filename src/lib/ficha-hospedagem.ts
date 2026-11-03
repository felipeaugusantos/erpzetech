import type { FichaHospedagemDados } from "./hotelaria-tipos.ts";

// Ficha de hospedagem para imprimir (campos da ficha nacional de registro de hóspedes, FNRH). A transmissão ao Ministério do Turismo é da Fase 2.
// Sem dependência de tela: o HTML sai de uma função pura e os testes rodam no Node.

const escapar = (s: string | number | null | undefined) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const dia = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

const ROTULO_DOC: Record<string, string> = {
  cpf: "CPF",
  rg: "RG",
  cnh: "CNH",
  passaporte: "Passaporte",
  outro: "Documento",
};
const MOTIVO: Record<string, string> = {
  lazer: "Lazer",
  negocios: "Negócios",
  congresso: "Congresso ou evento",
  parentes: "Visita a parentes ou amigos",
  estudos: "Estudos",
  saude: "Saúde",
  religiao: "Religião",
  compras: "Compras",
  outro: "Outro",
};
const TRANSPORTE: Record<string, string> = {
  aviao: "Avião",
  automovel: "Automóvel",
  onibus: "Ônibus",
  navio: "Navio",
  trem: "Trem",
  outro: "Outro",
};
const SEXO: Record<string, string> = { F: "Feminino", M: "Masculino", O: "Outro" };

export type EntradaFicha = {
  hotel: string;
  empresa?: string | null;
  ficha: Pick<
    FichaHospedagemDados,
    "reserva_numero" | "uh" | "entrada" | "saida" | "adultos" | "criancas" | "hospedes"
  >;
};

function linha(rotulo: string, valor: string | number | null | undefined) {
  const v = valor === null || valor === undefined || valor === "" ? "—" : escapar(valor);
  return `<tr><th>${escapar(rotulo)}</th><td>${v}</td></tr>`;
}

export function htmlFichaHospedagem({ hotel, empresa, ficha }: EntradaFicha): string {
  const hospedes = ficha.hospedes
    .map((h, i) => {
      const doc = h.documento_numero
        ? `${ROTULO_DOC[h.documento_tipo ?? ""] ?? "Documento"} ${h.documento_numero}`
        : null;
      const origem = [h.cidade_residencia, h.estado_residencia, h.pais_residencia]
        .filter(Boolean)
        .join(" / ");
      return `<section>
  <h3>${h.principal ? "Hóspede principal" : `Acompanhante ${i}`}</h3>
  <table>
    ${linha("Nome", h.nome)}
    ${linha("Documento", doc)}
    ${linha("Nacionalidade", h.nacionalidade)}
    ${linha("Nascimento", h.data_nascimento ? dia(h.data_nascimento) : null)}
    ${linha("Sexo", h.sexo ? (SEXO[h.sexo] ?? h.sexo) : null)}
    ${linha("Profissão", h.profissao)}
    ${linha("Residência", origem)}
    ${linha("Procedência", h.procedencia)}
    ${linha("Destino", h.destino)}
    ${linha("Motivo da viagem", h.motivo_viagem ? (MOTIVO[h.motivo_viagem] ?? h.motivo_viagem) : null)}
    ${linha("Meio de transporte", h.meio_transporte ? (TRANSPORTE[h.meio_transporte] ?? h.meio_transporte) : null)}
    ${linha("Telefone", h.telefone)}
    ${linha("E-mail", h.email)}
  </table>
  <div class="assinatura"><span>Assinatura</span></div>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha de hospedagem ${escapar(ficha.reserva_numero)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:24px}
  h1{font-size:18px;margin:0}h2{font-size:13px;margin:2px 0 14px;font-weight:normal;color:#444}h3{font-size:13px;margin:14px 0 4px}
  table{border-collapse:collapse;width:100%}th{text-align:left;width:34%;font-weight:600;padding:3px 6px;border-bottom:1px solid #ddd}td{padding:3px 6px;border-bottom:1px solid #ddd}
  .resumo th{width:22%}.assinatura{margin-top:26px;border-top:1px solid #111;width:60%;padding-top:3px;font-size:11px}
  section{page-break-inside:avoid}
</style></head><body>
<h1>Ficha de hospedagem</h1>
<h2>${escapar(hotel)}${empresa ? ` — ${escapar(empresa)}` : ""}</h2>
<table class="resumo">
  ${linha("Reserva", `nº ${ficha.reserva_numero}`)}
  ${linha("Acomodação", ficha.uh)}
  ${linha("Entrada", dia(ficha.entrada))}
  ${linha("Saída prevista", dia(ficha.saida))}
  ${linha("Pessoas", `${ficha.adultos} adulto(s)${ficha.criancas > 0 ? ` e ${ficha.criancas} criança(s)` : ""}`)}
</table>
${hospedes}
<p style="margin-top:18px;font-size:11px;color:#555">Declaro que as informações acima são verdadeiras e estou ciente das normas do estabelecimento.</p>
</body></html>`;
}
