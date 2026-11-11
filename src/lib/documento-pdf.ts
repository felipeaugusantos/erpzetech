// PDF do documento da clínica (receita, atestado, termo, solicitação de exames), gerado no navegador com jsPDF.
// Mesma informação da tela de impressão, em A4: cabeçalho da clínica, paciente, conteúdo, data, assinatura
// e a nota de que o documento não tem assinatura digital. Chame só em evento de usuário.

import {
  TIPOS_DOCUMENTO,
  dataPorExtenso,
  numeroDoDocumento,
  type DocumentoClinico,
} from "./documentos-clinica.ts";
import { dateBR } from "./format.ts";
import { ESPECIES, idadeDoPet, rotulo } from "./pet.ts";

const SEXOS: Record<string, string> = { macho: "Macho", femea: "Fêmea" };

const MARGEM = 20;
const LARGURA = 210 - 2 * MARGEM; // A4 em mm

export async function baixarPdfDocumento(d: DocumentoClinico): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGEM;

  const quebra = (texto: string, largura = LARGURA) =>
    doc.splitTextToSize(texto, largura) as string[];
  const linhas = (texto: string, altura: number, opcoes?: { centro?: boolean }) => {
    for (const l of quebra(texto)) {
      if (y > 282) {
        doc.addPage();
        y = MARGEM;
      }
      if (opcoes?.centro) doc.text(l, 105, y, { align: "center" });
      else doc.text(l, MARGEM, y);
      y += altura;
    }
  };

  const c = d.clinica;
  // cabeçalho da clínica
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  linhas((c?.nome ?? "Clínica veterinária").toUpperCase(), 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (c?.razao_social && c.razao_social !== c.nome) linhas(c.razao_social, 5);
  const contato = [c?.cnpj ? `CNPJ ${c.cnpj}` : null, c?.telefone, c?.email]
    .filter(Boolean)
    .join(" · ");
  if (contato) linhas(contato, 5);
  const endereco = c
    ? [
        [c.endereco, c.numero].filter(Boolean).join(", "),
        c.bairro,
        [c.cidade, c.estado].filter(Boolean).join("/"),
      ]
        .filter(Boolean)
        .join(" — ")
    : "";
  if (endereco) linhas(endereco, 5);
  y += 2;
  doc.line(MARGEM, y, 210 - MARGEM, y);
  y += 8;

  // título do documento
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  linhas(TIPOS_DOCUMENTO[d.tipo].impresso.toUpperCase(), 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  linhas(`nº ${numeroDoDocumento(d)}`, 5);
  if (d.titulo !== TIPOS_DOCUMENTO[d.tipo].rotulo) {
    doc.setFont("helvetica", "bold");
    linhas(d.titulo, 6);
    doc.setFont("helvetica", "normal");
  }
  y += 2;

  // paciente e tutor
  doc.setFontSize(10);
  const tutorDoc = d.tutor.cpf ?? d.tutor.cnpj;
  linhas(`Paciente: ${d.pet.nome}`, 5.5);
  linhas(`Tutor(a): ${d.tutor.nome}${tutorDoc ? ` · ${tutorDoc}` : ""}`, 5.5);
  linhas(
    `Espécie / raça: ${rotulo(ESPECIES, d.pet.especie)}${d.pet.raca ? ` · ${d.pet.raca}` : ""}`,
    5.5,
  );
  linhas(
    `Sexo / idade: ${d.pet.sexo ? (SEXOS[d.pet.sexo] ?? d.pet.sexo) : "—"}` +
      `${d.pet.nascimento ? ` · ${idadeDoPet(d.pet.nascimento)}` : ""}` +
      `${d.pet.peso_kg ? ` · ${String(d.pet.peso_kg).replace(".", ",")} kg` : ""}`,
    5.5,
  );
  y += 4;

  if (d.situacao === "cancelado") {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(180, 0, 0);
    linhas("DOCUMENTO CANCELADO", 6);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    y += 2;
  }

  // conteúdo
  if (d.tipo === "receita") {
    d.itens.forEach((i, k) => {
      doc.setFont("helvetica", "bold");
      linhas(`${k + 1}. ${i.medicamento}${i.quantidade ? ` — ${i.quantidade}` : ""}`, 6);
      doc.setFont("helvetica", "normal");
      linhas(i.posologia, 5.5);
      const detalhe = [i.via ? `Via ${i.via}` : null, i.duracao ? `Duração: ${i.duracao}` : null]
        .filter(Boolean)
        .join(" · ");
      if (detalhe) {
        doc.setFontSize(9);
        linhas(detalhe, 5);
        doc.setFontSize(10);
      }
      y += 1.5;
    });
  } else if (d.tipo === "solicitacao_exame") {
    for (const i of d.itens) {
      linhas(`☐ ${i.exame}${i.observacao ? ` — ${i.observacao}` : ""}`, 5.5);
    }
  }
  if (d.corpo) {
    y += 2;
    if (d.tipo === "receita" || d.tipo === "solicitacao_exame") {
      doc.setFont("helvetica", "bold");
      linhas(d.tipo === "receita" ? "Orientações" : "Indicação clínica", 6);
      doc.setFont("helvetica", "normal");
    }
    linhas(d.corpo, 5.5);
  }

  // data e assinaturas
  y += 8;
  linhas(`${c?.cidade ? `${c.cidade}, ` : ""}${dataPorExtenso(d.emitido_em)}.`, 5.5);
  y = Math.max(y + 22, 245);
  if (y > 262) {
    doc.addPage();
    y = MARGEM + 20;
  }
  doc.line(40, y, 100, y);
  if (d.tipo === "termo") doc.line(115, y, 175, y);
  doc.setFontSize(10);
  doc.text(d.veterinario.nome, 70, y + 5, { align: "center" });
  doc.setFontSize(8.5);
  doc.text(
    `Médico(a) veterinário(a) · CRMV ${d.veterinario.crmv}/${d.veterinario.crmv_uf}`,
    70,
    y + 9.5,
    {
      align: "center",
    },
  );
  if (d.tipo === "termo") {
    doc.setFontSize(10);
    doc.text(d.tutor.nome, 145, y + 5, { align: "center" });
    doc.setFontSize(8.5);
    doc.text(`Tutor(a)${tutorDoc ? ` · ${tutorDoc}` : ""}`, 145, y + 9.5, { align: "center" });
  }

  // rodapé
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  const rodape =
    `Emitido em ${dateBR(d.emitido_em)} pelo EZRA ERP. Documento sem assinatura digital. Campo para assinatura do médico-veterinário.` +
    (d.situacao === "cancelado"
      ? ` CANCELADO em ${dateBR(d.cancelado_em)}: ${d.cancelado_motivo ?? ""}.`
      : "");
  const rs = quebra(rodape);
  doc.text(rs, 105, 292 - (rs.length - 1) * 3.5, { align: "center" });

  doc.save(
    `${TIPOS_DOCUMENTO[d.tipo].rotulo.toLowerCase().replace(/\s+/g, "-")}-${String(d.numero).padStart(4, "0")}-${d.ano}.pdf`,
  );
}
