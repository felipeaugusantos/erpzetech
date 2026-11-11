#!/usr/bin/env python3
"""Gera src/lib/ncm-tabela.ts a partir da Tabela NCM oficial (Siscomex / Gecex, arquivo "Tabela_NCM_Vigente_AAAAMMDD.xlsx").
Guarda só os códigos de 8 dígitos vigentes (as posições de 2, 4 e 6 dígitos saem deles), agrupados por capítulo, com a data de
vigência e o ato legal da tabela. As descrições NÃO entram no sistema (pesam demais): para listas com descrição use
scripts/ncm-descricoes.py.
Uso: scripts/gerar-tabela-ncm.py <Tabela_NCM_Vigente.xlsx>   (a tabela muda por resolução da Gecex: rode de novo quando sair uma nova)."""
import datetime, os, re, sys

sys.path.insert(0, os.path.dirname(__file__))
from xlsx_lib import read

SAIDA = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "ncm-tabela.ts")
HOJE = datetime.date.today()


def data_br(texto):
    d, m, a = texto.split("/")
    return datetime.date(int(a), int(m), int(d))


def main(xlsx):
    planilha = read(xlsx)
    linhas = planilha[next(iter(planilha))]
    cabecalho = " ".join(str(c) for r in linhas[:4] for c in r if c)
    vig = re.search(r"Vigente em (\d{2}/\d{2}/\d{4})", cabecalho)
    ato = re.search(r"Última Atualização:\s*(.+?)\s*$", " ".join(str(r[0]) for r in linhas[:4] if r and r[0] and "Atualiza" in str(r[0])))
    if not vig or not ato:
        sys.exit("Não achei a data de vigência ou o ato legal no cabeçalho da planilha (esperava 'Vigente em DD/MM/AAAA' e 'Última Atualização: ...').")
    vigencia = data_br(vig.group(1))

    inicio = next(i for i, r in enumerate(linhas) if r and r[0] == "Código")
    oito = {}
    for r in linhas[inicio + 1 :]:
        r = r + [None] * (4 - len(r))
        if not r[0]:
            continue
        digitos = re.sub(r"\D", "", str(r[0]))
        if len(digitos) != 8:
            continue
        # só o que vale na data da tabela (início já começou e o fim não passou)
        if r[2] and data_br(r[2]) > vigencia:
            continue
        if r[3] and data_br(r[3]) < vigencia:
            continue
        oito[digitos] = True
    codigos = sorted(oito)
    if len(codigos) < 9000:
        sys.exit(f"Só {len(codigos)} NCMs de 8 dígitos: a planilha parece incompleta (esperava mais de 9.000).")

    por_capitulo = {}
    for c in codigos:
        por_capitulo.setdefault(c[:2], []).append(c[2:])

    linhas_ts = [
        "// GERADO por scripts/gerar-tabela-ncm.py a partir da Tabela NCM oficial (Siscomex / Gecex).",
        "// Não edite à mão: rode o script com a planilha nova quando a Gecex publicar uma resolução.",
        "",
        f'export const NCM_TABELA_VIGENCIA = "{vigencia.isoformat()}";',
        f'export const NCM_TABELA_ATO = "{ato.group(1).rstrip(".")}";',
        f"export const NCM_TABELA_TOTAL = {len(codigos)};",
        "",
        "/** NCMs de 8 dígitos vigentes por capítulo: cada valor junta os 6 últimos dígitos de cada código, em ordem. */",
        "export const NCM_POR_CAPITULO: Readonly<Record<string, string>> = {",
    ]
    for cap in sorted(por_capitulo):
        linhas_ts.append(f'  "{cap}": "{"".join(por_capitulo[cap])}",')
    linhas_ts.append("};")
    linhas_ts.append("")
    with open(SAIDA, "w", encoding="utf-8") as f:
        f.write("\n".join(linhas_ts))
    print(f"{len(codigos)} NCMs de 8 dígitos em {len(por_capitulo)} capítulos; vigência {vigencia.isoformat()}; {ato.group(1)}")
    if (HOJE - vigencia).days > 180:
        print("ATENÇÃO: a tabela tem mais de 180 dias; confira se saiu resolução nova da Gecex.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
