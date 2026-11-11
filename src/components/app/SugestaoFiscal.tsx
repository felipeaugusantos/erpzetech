import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  ROTULO_ORIGEM_REGRA,
  aplicacaoIbsCbs,
  ibsCbsJaIgual,
  lerSugestaoFiscal,
  linhasDoPerfil,
  ncmConsultavel,
  ncmDigitos,
  type PerfilSugerido,
  type RegraSugerida,
} from "@/lib/fiscal-sugestao";

type Chamada = (
  nome: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

function Valores({ perfil }: { perfil: PerfilSugerido }) {
  const linhas = linhasDoPerfil(perfil);
  if (linhas.length === 0) return null;
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1">
      {linhas.map((l) => (
        <div key={l.rotulo} className="flex gap-1">
          <dt className="text-muted-foreground">{l.rotulo}:</dt>
          <dd className="font-medium">{l.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function Origem({ regra }: { regra: RegraSugerida }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge variant={regra.origem === "empresa" ? "default" : "secondary"}>
        {ROTULO_ORIGEM_REGRA[regra.origem]}
      </Badge>
      <span>
        {regra.perfilNome && <strong>{regra.perfilNome}</strong>}
        {regra.perfilNome && " · "}
        versão {regra.versao}
        {regra.ncmPrefixo && ` · NCM ${regra.ncmPrefixo}`}
      </span>
    </span>
  );
}

/** Ação de aplicar a tributação IBS/CBS de um perfil ao produto (a única que o cadastro tem hoje). */
function AcaoIbsCbs({
  perfil,
  cstAtual,
  cClassTribAtual,
  rotulo,
  onAplicar,
}: {
  perfil: PerfilSugerido;
  cstAtual: string;
  cClassTribAtual: string;
  rotulo: string;
  onAplicar: (cst: string, cclasstrib: string) => void;
}) {
  const ap = aplicacaoIbsCbs(perfil);
  if (ap.tipo === "sem_ibs_cbs") {
    return <p className="text-muted-foreground">Este perfil não define a tributação IBS/CBS.</p>;
  }
  if (ap.tipo === "nao_suportada") {
    return (
      <p className="text-muted-foreground">
        IBS/CBS sugerido (CST {ap.cst}, cClassTrib {ap.cclasstrib}) não pode ser aplicado:{" "}
        {ap.motivo}
      </p>
    );
  }
  if (ibsCbsJaIgual({ cst: cstAtual, cclasstrib: cClassTribAtual }, ap)) {
    return (
      <p className="text-muted-foreground">A tributação IBS/CBS do produto já é a da sugestão.</p>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => onAplicar(ap.cst, ap.cclasstrib)}
    >
      {rotulo}
    </Button>
  );
}

/**
 * Sugestão fiscal da base (regras por NCM) no cadastro de produto. Só consulta e mostra: aplicar é sempre um clique da pessoa,
 * e hoje só a tributação IBS/CBS tem campo no cadastro; os demais valores (CFOP, CST, alíquotas…) são para consulta.
 * Se a consulta falhar, o cadastro segue normal.
 */
export function SugestaoFiscal({
  ncm,
  tenantId,
  cstAtual,
  cClassTribAtual,
  onAplicarIbsCbs,
}: {
  ncm: string;
  tenantId: string | undefined;
  cstAtual: string;
  cClassTribAtual: string;
  onAplicarIbsCbs: (cst: string, cclasstrib: string) => void;
}) {
  const digitos = ncmDigitos(ncm);
  const consulta = useQuery({
    // a empresa na chave: as sobrescritas são dela e o cache do navegador não pode misturar empresas
    queryKey: ["fiscal-sugestao", tenantId ?? "", digitos],
    enabled: ncmConsultavel(ncm) && Boolean(tenantId),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      // os tipos gerados só conhecem a função depois da migração aplicada
      const rpc = (supabase as unknown as { rpc: Chamada }).rpc.bind(supabase);
      const { data, error } = await rpc("fiscal_sugerir", { p_ncm: digitos, p_operacao: "venda" });
      if (error) throw new Error(error.message);
      const s = lerSugestaoFiscal(data);
      if (!s) throw new Error("Resposta inesperada da base fiscal");
      return s;
    },
  });

  if (digitos.length === 0) return null;
  const caixa = "space-y-2 rounded-md border bg-muted/30 p-3 text-sm";
  const aviso = (texto: string) => (
    <div className={caixa} aria-live="polite">
      <p className="text-muted-foreground">{texto}</p>
    </div>
  );

  if (!ncmConsultavel(ncm))
    return aviso("Digite os 8 dígitos do NCM para ver a sugestão da base fiscal.");
  if (consulta.isPending) return aviso("Consultando a base fiscal…");
  if (consulta.isError) {
    return aviso(
      "Sugestão da base fiscal indisponível agora. O cadastro pode continuar normalmente.",
    );
  }
  const s = consulta.data;
  if (s.status === "ncm_invalido") return aviso("NCM inválido para consultar a base fiscal.");
  if (s.status === "sem_regra") {
    return aviso("A base fiscal não tem regra para este NCM. Preencha manualmente, se precisar.");
  }

  const ufLinha =
    s.ufDestino === undefined ? null : (
      <p className="text-xs text-muted-foreground">
        {s.ufDestino
          ? `Considerando venda dentro de ${s.ufDestino} (a UF da empresa).`
          : "A empresa não tem UF cadastrada: regras por UF não foram consideradas."}
      </p>
    );
  const rodape = (
    <>
      {ufLinha}
      <p className="text-xs text-muted-foreground">
        É uma sugestão, não substitui a validação do contador. Aplicar preenche só a tributação
        IBS/CBS do produto; os demais valores são para consulta.
      </p>
    </>
  );

  if (s.status === "empate") {
    return (
      <div className={caixa} aria-live="polite">
        <p className="font-medium">
          Sugestão da base fiscal: mais de uma regra serve para este NCM
        </p>
        <p className="text-muted-foreground">
          Há regras igualmente específicas e o sistema não escolhe sozinho. Veja qual vale para este
          produto.
        </p>
        <ul className="space-y-3">
          {s.candidatas.map((c) => (
            <li key={c.id} className="space-y-1 rounded-md border bg-background p-2">
              <Origem regra={c} />
              <Valores perfil={c.perfil} />
              <AcaoIbsCbs
                perfil={c.perfil}
                cstAtual={cstAtual}
                cClassTribAtual={cClassTribAtual}
                rotulo="Usar esta (IBS/CBS)"
                onAplicar={onAplicarIbsCbs}
              />
            </li>
          ))}
        </ul>
        {rodape}
      </div>
    );
  }

  return (
    <div className={caixa} aria-live="polite">
      <p className="font-medium">Sugestão da base fiscal</p>
      <Origem regra={s.regra} />
      <Valores perfil={s.perfil} />
      <AcaoIbsCbs
        perfil={s.perfil}
        cstAtual={cstAtual}
        cClassTribAtual={cClassTribAtual}
        rotulo="Usar sugestão (IBS/CBS)"
        onAplicar={onAplicarIbsCbs}
      />
      {rodape}
    </div>
  );
}
