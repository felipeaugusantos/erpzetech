import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OPERACOES,
  REGIMES,
  dataBr,
  formNovaVersao,
  formVazio,
  montarDadosRegra,
  resumoDoPerfil,
  type DadosRegraEmpresa,
  type FormRegraEmpresa,
  type PerfilDisponivel,
  type RegraEmpresa,
} from "@/lib/fiscal-empresa";
import { UFS_BRASIL } from "@/lib/fiscal-importacao";

const QUALQUER = "qualquer";

type Texto = Exclude<keyof FormRegraEmpresa, "perfilModo">;

const CAMPOS_PERFIL: { campo: Texto; rotulo: string; dica: string }[] = [
  { campo: "cfop", rotulo: "CFOP", dica: "4 dígitos, ex.: 5102" },
  { campo: "cstIcms", rotulo: "CST do ICMS", dica: "Regime normal, ex.: 00, 60" },
  { campo: "csosn", rotulo: "CSOSN", dica: "Simples Nacional, ex.: 102" },
  { campo: "aliqIcms", rotulo: "Alíquota de ICMS (%)", dica: "ex.: 18" },
  { campo: "reducaoBaseIcms", rotulo: "Redução da base do ICMS (%)", dica: "ex.: 33,33" },
  { campo: "mvaSt", rotulo: "MVA-ST (%)", dica: "substituição tributária" },
  { campo: "cstPis", rotulo: "CST do PIS", dica: "ex.: 01" },
  { campo: "aliqPis", rotulo: "Alíquota de PIS (%)", dica: "ex.: 1,65" },
  { campo: "cstCofins", rotulo: "CST do COFINS", dica: "ex.: 01" },
  { campo: "aliqCofins", rotulo: "Alíquota de COFINS (%)", dica: "ex.: 7,6" },
  { campo: "cstIbsCbs", rotulo: "CST do IBS/CBS", dica: "3 dígitos" },
  { campo: "cclasstrib", rotulo: "cClassTrib", dica: "6 dígitos" },
  { campo: "origem", rotulo: "Origem da mercadoria", dica: "0 a 8" },
];

/** Criar uma sobrescrita da empresa ou uma nova versão de uma que já existe (os critérios ficam travados). */
export function RegraFiscalDialog({
  aberto,
  onFechar,
  versaoDe,
  hoje,
  perfis,
  salvando,
  erroDoBanco,
  onSalvar,
}: {
  aberto: boolean;
  onFechar: () => void;
  /** nova versão desta regra; ausente = regra nova */
  versaoDe: RegraEmpresa | null;
  hoje: string;
  perfis: PerfilDisponivel[];
  salvando: boolean;
  erroDoBanco: string | null;
  onSalvar: (dados: DadosRegraEmpresa) => void;
}) {
  const inicial = useMemo(
    () => (versaoDe ? formNovaVersao(versaoDe, hoje) : formVazio(hoje)),
    [versaoDe, hoje],
  );
  const [form, setForm] = useState<FormRegraEmpresa>(inicial);
  const [erros, setErros] = useState<string[]>([]);
  const travado = versaoDe !== null;
  const mudar = (campo: Texto, valor: string) => setForm((f) => ({ ...f, [campo]: valor }));

  function salvar() {
    const r = montarDadosRegra(form, versaoDe ?? undefined);
    setErros(r.erros);
    if (r.dados) onSalvar(r.dados);
  }

  const globais = perfis.filter((p) => p.origem === "global");
  const proprios = perfis.filter((p) => p.origem === "empresa");
  const item = (p: PerfilDisponivel) => (
    <SelectItem key={p.id} value={p.id}>
      {p.nome} — {resumoDoPerfil(p.perfil)}
    </SelectItem>
  );

  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && !salvando && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {versaoDe ? `Nova versão — NCM ${versaoDe.ncmPrefixo}` : "Nova regra da empresa"}
          </DialogTitle>
          <DialogDescription>
            {versaoDe
              ? `A versão ${versaoDe.versao} termina no dia anterior ao início da nova e continua no histórico.`
              : "Vale só para a sua empresa e passa na frente das regras da base."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="rf-ncm">NCM (2, 4, 6 ou 8 dígitos)</Label>
              <Input
                id="rf-ncm"
                value={form.ncm}
                disabled={travado}
                onChange={(e) => mudar("ncm", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rf-cest">CEST (opcional)</Label>
              <Input
                id="rf-cest"
                value={form.cest}
                disabled={travado}
                onChange={(e) => mudar("cest", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Operação</Label>
              <Select
                value={form.operacao || QUALQUER}
                disabled={travado}
                onValueChange={(v) => mudar("operacao", v === QUALQUER ? "" : v)}
              >
                <SelectTrigger aria-label="Operação">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={QUALQUER}>Qualquer</SelectItem>
                  {OPERACOES.map((o) => (
                    <SelectItem key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Regime tributário</Label>
              <Select
                value={form.regime || QUALQUER}
                disabled={travado}
                onValueChange={(v) => mudar("regime", v === QUALQUER ? "" : v)}
              >
                <SelectTrigger aria-label="Regime tributário">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={QUALQUER}>Qualquer</SelectItem>
                  {REGIMES.map((r) => (
                    <SelectItem key={r.valor} value={r.valor}>
                      {r.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>UF de destino</Label>
              <Select
                value={form.ufDestino || QUALQUER}
                disabled={travado}
                onValueChange={(v) => mudar("ufDestino", v === QUALQUER ? "" : v)}
              >
                <SelectTrigger aria-label="UF de destino">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={QUALQUER}>Todas</SelectItem>
                  {UFS_BRASIL.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rf-inicio">Início da vigência</Label>
              <Input
                id="rf-inicio"
                type="date"
                value={form.vigenciaInicio}
                onChange={(e) => mudar("vigenciaInicio", e.target.value)}
              />
              {versaoDe && (
                <p className="text-xs text-muted-foreground">
                  Precisa ser depois de {dataBr(versaoDe.vigenciaInicio)}.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="rf-fim">Fim da vigência (opcional)</Label>
              <Input
                id="rf-fim"
                type="date"
                value={form.vigenciaFim}
                onChange={(e) => mudar("vigenciaFim", e.target.value)}
              />
            </div>
          </div>

          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 font-medium">Tributação</legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="rf-perfil-modo"
                  checked={form.perfilModo === "existente"}
                  onChange={() => setForm((f) => ({ ...f, perfilModo: "existente" }))}
                />
                Usar um perfil existente
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="rf-perfil-modo"
                  checked={form.perfilModo === "novo"}
                  onChange={() => setForm((f) => ({ ...f, perfilModo: "novo" }))}
                />
                Criar um perfil próprio
              </label>
            </div>
            {form.perfilModo === "existente" ? (
              <div className="space-y-1">
                <Label>Perfil</Label>
                <Select value={form.perfilId} onValueChange={(v) => mudar("perfilId", v)}>
                  <SelectTrigger aria-label="Perfil">
                    <SelectValue placeholder="Escolha o perfil" />
                  </SelectTrigger>
                  <SelectContent>
                    {proprios.length > 0 && (
                      <>
                        <p className="px-2 py-1 text-xs text-muted-foreground">Da sua empresa</p>
                        {proprios.map(item)}
                      </>
                    )}
                    {globais.length > 0 && (
                      <>
                        <p className="px-2 py-1 text-xs text-muted-foreground">Da base</p>
                        {globais.map(item)}
                      </>
                    )}
                  </SelectContent>
                </Select>
                {perfis.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Ainda não há perfis. Crie um perfil próprio.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="rf-nome">Nome do perfil</Label>
                  <Input
                    id="rf-nome"
                    value={form.perfilNome}
                    maxLength={120}
                    onChange={(e) => mudar("perfilNome", e.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {CAMPOS_PERFIL.map((c) => (
                    <div key={c.campo} className="space-y-1">
                      <Label htmlFor={`rf-${c.campo}`}>{c.rotulo}</Label>
                      <Input
                        id={`rf-${c.campo}`}
                        value={form[c.campo]}
                        placeholder={c.dica}
                        onChange={(e) => mudar(c.campo, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Preencha ao menos um campo. Um perfil já usado não muda de valores: para mudar a
                  tributação, use outro nome.
                </p>
              </div>
            )}
          </fieldset>

          <div className="space-y-1">
            <Label htmlFor="rf-obs">Observação (opcional)</Label>
            <Input
              id="rf-obs"
              value={form.observacao}
              onChange={(e) => mudar("observacao", e.target.value)}
            />
          </div>

          {(erros.length > 0 || erroDoBanco) && (
            <ul role="alert" className="list-disc space-y-1 pl-5 text-destructive">
              {erros.map((e) => (
                <li key={e}>{e}</li>
              ))}
              {erroDoBanco && <li>{erroDoBanco}</li>}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            É uma configuração fiscal da sua empresa. Confirme com o seu contador antes de usar.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={salvando} onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={salvar}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
