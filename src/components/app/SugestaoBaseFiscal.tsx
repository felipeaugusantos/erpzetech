import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  camposDoProduto,
  edicoesDaSugestao,
  type EdicaoProduto,
  type ModoAplicar,
  type ProdutoFiscalAtual,
  type RegimeLote,
  type ResumoLote,
} from "@/lib/fiscal-lote";
import { ROTULO_ORIGEM_REGRA, type SugestaoFiscal } from "@/lib/fiscal-sugestao";

/** Painel da tela Fiscal: consulta a base para os produtos da lista e prepara as edições em rascunho. Nunca grava. */
export function PainelSugestaoBase({
  regime,
  uf,
  ncmsNaLista,
  modo,
  onModo,
  consultando,
  erro,
  resumo,
  onConsultar,
  onAplicar,
}: {
  /** regime da empresa (define se a base sugere CSOSN ou CST do ICMS) */
  regime: RegimeLote;
  /** UF da empresa usada na última consulta (venda dentro do estado); nulo = empresa sem UF; indefinido = ainda não consultou */
  uf?: string | null | undefined;
  /** quantos NCMs distintos de 8 dígitos há na lista */
  ncmsNaLista: number;
  modo: ModoAplicar;
  onModo: (m: ModoAplicar) => void;
  consultando: boolean;
  erro: string | null;
  resumo: ResumoLote | null;
  onConsultar: () => void;
  onAplicar: () => void;
}) {
  return (
    <div className="panel mt-4 p-4">
      <h2 className="font-display text-sm font-semibold">Sugestão da base fiscal</h2>
      <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
        Consulta as regras por NCM (as da sua empresa passam na frente das da base) e prepara CFOP,{" "}
        {regime === "normal" ? "CST do ICMS" : "CSOSN"}, alíquota de ICMS e origem dos produtos da
        lista. Nada é gravado agora: as sugestões entram como edição em rascunho e só o botão Salvar
        grava. A nota usa o que estiver no produto. PIS, COFINS, redução de base, MVA e IBS/CBS não
        são aplicados aqui. É uma sugestão: confirme com o seu contador.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="modo-base-fiscal"
            checked={modo === "faltantes"}
            onChange={() => onModo("faltantes")}
          />
          Só preencher o que falta
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="modo-base-fiscal"
            checked={modo === "substituir"}
            onChange={() => onModo("substituir")}
          />
          Também trocar o que já está preenchido e é diferente
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={consultando || ncmsNaLista === 0}
          onClick={onConsultar}
        >
          {consultando
            ? "Consultando…"
            : ncmsNaLista === 0
              ? "Nenhum NCM completo na lista"
              : `Consultar a base (${ncmsNaLista} NCM${ncmsNaLista === 1 ? "" : "s"})`}
        </Button>
      </div>
      {erro && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erro}
        </p>
      )}
      {resumo && uf !== undefined && (
        <p className="mt-2 text-xs text-muted-foreground">
          {uf
            ? `Consulta feita para vendas dentro de ${uf} (a UF da empresa): regras da UF valem, e as sem UF também.`
            : "A empresa não tem UF cadastrada: regras por UF não foram consideradas. Cadastre a UF na empresa para considerá-las."}
        </p>
      )}
      {resumo && (
        <div className="mt-3 space-y-2 text-sm" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{resumo.comRegra} com regra</Badge>
            <Badge variant="secondary">{resumo.semRegra} sem regra</Badge>
            {resumo.empate > 0 && <Badge variant="secondary">{resumo.empate} com empate</Badge>}
            {resumo.ncmInvalido > 0 && (
              <Badge variant="secondary">{resumo.ncmInvalido} com NCM inválido</Badge>
            )}
          </div>
          <p>
            <strong>{resumo.comMudanca}</strong> produto(s) com mudança ({resumo.campos} campo(s)).{" "}
            {resumo.semMudanca > 0 &&
              `${resumo.semMudanca} já estão iguais à base ou têm valor que a emissão ainda não sabe formatar. `}
            {resumo.empate > 0 &&
              "Produtos com empate entre regras ficam de fora: escolha a regra no cadastro do produto."}
          </p>
          <Button size="sm" disabled={resumo.comMudanca === 0} onClick={onAplicar}>
            Aplicar na lista ({resumo.comMudanca})
          </Button>
        </div>
      )}
    </div>
  );
}

/** Linha da base logo abaixo do produto: o que a base sugere, avisos e o botão para usar só nesse produto. */
export function LinhaSugestaoBase({
  sugestao,
  regime,
  produto,
  onUsar,
}: {
  sugestao: SugestaoFiscal | undefined;
  regime: RegimeLote;
  produto: ProdutoFiscalAtual;
  onUsar: (edicao: EdicaoProduto) => void;
}) {
  if (!sugestao) return null;
  if (sugestao.status === "empate") {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        Base: mais de uma regra serve para este NCM. Escolha no cadastro do produto.
      </p>
    );
  }
  if (sugestao.status !== "regra") return null;

  const { campos, avisos } = camposDoProduto(sugestao.perfil, regime);
  const partes = [
    campos.cfop && `CFOP ${campos.cfop}`,
    campos.cst_csosn && `${regime === "normal" ? "CST" : "CSOSN"} ${campos.cst_csosn}`,
    campos.aliquota_icms !== undefined && `ICMS ${campos.aliquota_icms}%`,
    campos.origem_mercadoria && `Origem ${campos.origem_mercadoria}`,
  ].filter(Boolean);
  const edicao = edicoesDaSugestao(produto, campos, "substituir");
  const diferente = Object.keys(edicao).length > 0;

  return (
    <div className="mt-1 space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={sugestao.regra.origem === "empresa" ? "default" : "secondary"}>
          {ROTULO_ORIGEM_REGRA[sugestao.regra.origem]}
        </Badge>
        <span className="text-muted-foreground">
          {sugestao.regra.perfilNome && `${sugestao.regra.perfilNome} · `}versão{" "}
          {sugestao.regra.versao}
          {partes.length > 0 ? `: ${partes.join(" · ")}` : ""}
        </span>
        {diferente ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => onUsar(edicao)}
          >
            Usar a sugestão
          </Button>
        ) : (
          partes.length > 0 && <span className="text-muted-foreground">já igual à base</span>
        )}
      </div>
      {avisos.map((a) => (
        <p key={a} className="text-warning">
          {a}
        </p>
      ))}
    </div>
  );
}
