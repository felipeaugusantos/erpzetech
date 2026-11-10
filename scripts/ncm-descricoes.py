#!/usr/bin/env python3
"""Lista NCMs de 8 dígitos com a descrição COMPLETA, para colar nos prompts da carga fiscal (docs/carga-fiscal-inicial.md).
A Tabela NCM é hierárquica: "Outros" só faz sentido com o que vem acima. Aqui a descrição de cada NCM junta a posição (4 dígitos)
e todos os níveis até o item: "Cavalos, asininos e muares, vivos > Cavalos > Outros".

Uso:
  scripts/ncm-descricoes.py <Tabela_NCM_Vigente.xlsx> --capitulo 23 [--capitulo 30 ...]
  scripts/ncm-descricoes.py <Tabela_NCM_Vigente.xlsx> --posicao 2309 [--posicao 3004 ...]
  scripts/ncm-descricoes.py <Tabela_NCM_Vigente.xlsx> --ncms lista.csv     (1ª coluna = NCM; as demais colunas são mantidas)
Saída (padrão): uma linha por NCM, "23091000 — Preparações dos tipos ... > Alimentos para cães ou gatos ...".
  --csv   saída em CSV (ncm;descricao[;colunas extras])
  --max N para no N-ésimo NCM e avisa (as rodadas de prompt rendem melhor com 30 a 80 NCMs)."""
import argparse, os, re, sys

sys.path.insert(0, os.path.dirname(__file__))
from xlsx_lib import read


def limpar(texto):
    t = re.sub(r"\s+", " ", str(texto or "")).strip()
    t = re.sub(r"^-+\s*", "", t)
    return t.rstrip(":. ").strip()


def carregar(xlsx):
    """Devolve {ncm8: descrição composta}. A hierarquia vem do próprio código: o "pai" de uma linha é a linha anterior mais próxima
    cujo código (só dígitos) é prefixo menor do dela. Funciona com e sem traços na descrição (em 2501.00 os níveis abaixo não têm traço)."""
    planilha = read(xlsx)
    linhas = planilha[next(iter(planilha))]
    inicio = next(i for i, r in enumerate(linhas) if r and r[0] == "Código")
    pilha = []  # [(digitos, texto)]
    saida = {}
    for r in linhas[inicio + 1 :]:
        if not r or not r[0]:
            continue
        digitos = re.sub(r"\D", "", str(r[0]))
        while pilha and not (len(pilha[-1][0]) < len(digitos) and digitos.startswith(pilha[-1][0])):
            pilha.pop()
        pilha.append((digitos, limpar(r[1])))
        if len(digitos) == 8:
            # o capítulo (2 dígitos) não entra: é genérico demais
            cadeia = [t for d, t in pilha if len(d) > 2 and t]
            saida[digitos] = " > ".join(cadeia)
    return saida


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("xlsx")
    ap.add_argument("--capitulo", action="append", default=[], help="capítulo de 2 dígitos, ex.: 23")
    ap.add_argument("--posicao", action="append", default=[], help="posição de 4 dígitos, ex.: 2309")
    ap.add_argument("--ncms", help="arquivo CSV/texto com NCMs na primeira coluna")
    ap.add_argument("--csv", action="store_true")
    ap.add_argument("--max", type=int, default=0)
    a = ap.parse_args()
    if not (a.capitulo or a.posicao or a.ncms):
        ap.error("informe --capitulo, --posicao ou --ncms")

    tabela = carregar(a.xlsx)
    itens = []  # (ncm, extras)
    for c in a.capitulo:
        itens += [(n, []) for n in sorted(tabela) if n.startswith(c.zfill(2))]
    for p in a.posicao:
        itens += [(n, []) for n in sorted(tabela) if n.startswith(re.sub(r"\D", "", p))]
    ausentes = []
    if a.ncms:
        with open(a.ncms, encoding="utf-8-sig") as f:
            for linha in f:
                partes = [x.strip() for x in re.split(r"[;\t,]", linha.rstrip("\n"))]
                d = re.sub(r"\D", "", partes[0]) if partes and partes[0] else ""
                if len(d) != 8:
                    continue  # cabeçalho ou linha que não é NCM de 8 dígitos
                if d not in tabela:
                    ausentes.append(d)
                    continue
                itens.append((d, partes[1:]))
    vistos, final = set(), []
    for n, extras in itens:
        if n not in vistos:
            vistos.add(n)
            final.append((n, extras))
    limitado = a.max and len(final) > a.max
    if limitado:
        final = final[: a.max]
    for n, extras in final:
        if a.csv:
            print(";".join([n, '"' + tabela[n].replace('"', '""') + '"'] + extras))
        else:
            print(f"{n} — {tabela[n]}" + (f"  [{' | '.join(extras)}]" if extras else ""))
    if ausentes:
        print(f"# AVISO: {len(ausentes)} NCM(s) da lista NÃO constam na tabela: {', '.join(sorted(set(ausentes)))}", file=sys.stderr)
    if limitado:
        print(f"# AVISO: lista cortada em {a.max} NCMs.", file=sys.stderr)


if __name__ == "__main__":
    main()
