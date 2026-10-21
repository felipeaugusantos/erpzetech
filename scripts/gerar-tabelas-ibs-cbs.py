#!/usr/bin/env python3
"""Gera src/lib/ibs-cbs-tabelas.ts a partir das planilhas do Informe Técnico (Portal Nacional da NF-e):
cClassTrib (com a aba CST) e cCredPres. Uso: scripts/gerar-tabelas-ibs-cbs.py <cClassTrib.xlsx> <cCredPres.xlsx>"""
import datetime, json, re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from xlsx_lib import read


def data(v):
    if v in (None, ""):
        return None
    return (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(float(v)))).isoformat()


def n(v):
    return float(v) if v not in (None, "") else 0


def flag(v):
    return 1 if str(v).strip() in ("1", "1.0") else 0


def main(cclass_xlsx, credpres_xlsx):
    d = read(cclass_xlsx)
    aba = next(k for k in d if k.startswith("cClass"))
    versao = aba.replace("cClass", "").strip()
    cls = []
    for r in d[aba][1:]:
        r = r + [None] * (30 - len(r))
        if not r[2]:
            continue
        cls.append([
            r[0], r[2], re.sub(r"\s+", " ", r[3] or "").strip(), r[9], n(r[10]), n(r[11]), flag(r[12]), flag(r[13]),
            1 if any(flag(x) for x in r[14:17]) else 0, flag(r[18]), flag(r[25]), flag(r[26]), data(r[21]), data(r[22]),
        ])
    cst = []
    for r in d[next(k for k in d if k.startswith("CST"))][1:]:
        r = r + [None] * (10 - len(r))
        if r[0] and re.fullmatch(r"\d{3}", str(r[0])):
            cst.append([r[0], re.sub(r"\s+", " ", r[1] or "").strip()] + [flag(x) for x in r[2:10]])
    c = read(credpres_xlsx)
    cred = []
    for r in c["cCredPres"][1:]:
        r = r + [None] * (20 - len(r))
        if r[0]:
            cred.append([str(r[0]).zfill(2), re.sub(r"\s+", " ", r[1] or "").strip(), flag(r[3]), flag(r[4]), flag(r[5]), r[13]])
    sai = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "ibs-cbs-tabelas.ts")
    j = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    with open(sai, "w", encoding="utf-8") as f:
        f.write("// GERADO por scripts/gerar-tabelas-ibs-cbs.py a partir do Informe Técnico 2025.002 RTC (Portal Nacional da NF-e).\n")
        f.write("// Não edite à mão: rode o script com as planilhas novas quando o Informe Técnico mudar.\n\n")
        f.write(f'export const VERSAO_TABELAS_IBS_CBS = "{versao}";\n\n')
        f.write("/** [cst, cClassTrib, nome, tipoAliquota, pRedIBS, pRedCBS, indTribRegular, indCredPresOper, indMonofasia, indEstornoCred, indNFe, indNFCe, vigenciaInicio, vigenciaFim] */\n")
        f.write(f"export const CCLASSTRIB_LINHAS: readonly (readonly [string, string, string, string, number, number, number, number, number, number, number, number, string | null, string | null])[] = {j(cls)};\n\n")
        f.write("/** [cst, descricao, indGIBSCBS, indGIBSCBSMono, indGRed, indGDif, indGTransfCred, indGCredPresIBSZFM, indGAjusteCompet, indRedutorBC] */\n")
        f.write(f"export const CST_LINHAS: readonly (readonly [string, string, number, number, number, number, number, number, number, number])[] = {j(cst)};\n\n")
        f.write("/** [cCredPres, descricao, apropriaViaNF, apropriaViaEvento, indDeduzCredPres, cClassTribNotaReferenciada] */\n")
        f.write(f"export const CCREDPRES_LINHAS: readonly (readonly [string, string, number, number, number, string | null])[] = {j(cred)};\n")
    os.system("npx prettier --write " + sai + " > /dev/null")
    print(versao, len(cls), "cClassTrib;", len(cst), "CST;", len(cred), "cCredPres")


main(sys.argv[1], sys.argv[2])
