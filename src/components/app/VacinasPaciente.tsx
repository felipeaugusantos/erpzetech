import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Syringe } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { supabase } from "@/integrations/supabase/client";
import { dateBR } from "@/lib/format";
import { hojeISO } from "@/lib/financeiro";
import { dadosLoteManual, dadosServicoCobrado } from "@/lib/vacina-lote-manual";
import { DOSES_APLICACAO, dadosDoseAplicacao } from "@/lib/vacina-dose";
import {
  ATALHOS_PROXIMA_DOSE,
  dataDoAtalho,
  diasAte,
  situacaoDaDose,
  rotuloDose,
  resumoDoProtocolo,
  type CartaoVacinacao,
  type ItemCatalogo,
} from "@/lib/vacinas";

/** Botões "7 dias", "21 dias", "30 dias" e "1 ano": preenchem a data a partir do dia da aplicação (sem `base`, do dia de hoje no momento do clique). */
function AtalhosProximaDose({
  base,
  valor,
  onEscolher,
  desativado,
}: {
  base?: string;
  valor: string;
  onEscolher: (data: string) => void;
  desativado?: boolean;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {ATALHOS_PROXIMA_DOSE.map((a) => {
        const data = dataDoAtalho(base ?? hojeISO(), a);
        return (
          <Button
            key={a.rotulo}
            type="button"
            size="sm"
            variant={valor === data ? "default" : "outline"}
            disabled={desativado}
            onClick={() => onEscolher(base ? data : dataDoAtalho(hojeISO(), a))}
            title={`Próxima dose em ${dateBR(data)}`}
          >
            {a.rotulo}
          </Button>
        );
      })}
    </div>
  );
}

type Aplicador = { id: string; nome: string; funcao: string };
type Retorno = {
  avisos?: string[];
  proxima_dose_em: string | null;
  dose_tipo: string;
  dose_numero: number;
};

export function VacinasPaciente({
  pet: petId,
  agendamento,
  aplicar: abrirAplicacao,
  embutido = false,
}: {
  pet: string;
  agendamento?: string | undefined;
  aplicar?: boolean | undefined;
  embutido?: boolean;
}) {
  const [avulso, setAvulso] = useState(Boolean(abrirAplicacao));
  const [servicoId, setServicoId] = useState("");
  const [aplicadaEm, setAplicadaEm] = useState(hojeISO());
  // Chave de repetição: a mesma em reenvios da mesma aplicação, nova depois de gravar.
  const [chave, setChave] = useState(() => crypto.randomUUID());
  const qc = useQueryClient();
  const hoje = hojeISO();
  const [catalogoId, setCatalogoId] = useState("");
  const [dose, setDose] = useState("auto");
  const [lote, setLote] = useState("");
  const [validadeLote, setValidadeLote] = useState("");
  const [aplicador, setAplicador] = useState("");
  const [local, setLocal] = useState("");
  const [obs, setObs] = useState("");
  const [proxima, setProxima] = useState("");
  const [semProxima, setSemProxima] = useState(false);
  const [externa, setExterna] = useState(false);
  const [ext, setExt] = useState({
    catalogo: "",
    dose: "auto",
    data: hoje,
    informado: "",
    lote: "",
    proxima: "",
  });
  const [cancelando, setCancelando] = useState<{ id: string; motivo: string } | null>(null);

  const catalogo = useQuery({
    queryKey: ["clinica-catalogo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_vacinas_catalogo");
      if (error) throw error;
      return ((data ?? []) as unknown as ItemCatalogo[]).filter((i) => i.ativo);
    },
  });
  const cartao = useQuery({
    queryKey: ["clinica-cartao", petId],
    enabled: Boolean(petId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_cartao_vacinacao", {
        p_pet_id: petId as string,
      });
      if (error) throw error;
      return data as unknown as CartaoVacinacao;
    },
  });
  const aplicadores = useQuery({
    queryKey: ["clinica-aplicadores"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_aplicadores");
      if (error) throw error;
      return (data ?? []) as unknown as Aplicador[];
    },
  });

  const servicos = useQuery({
    queryKey: ["clinica-servicos-vacina"],
    enabled: avulso && !agendamento,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_servicos")
        .select("id, nome")
        .eq("categoria", "vacina")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
  const servicoAtual = servicoId;

  const item = catalogo.data?.find((i) => i.id === catalogoId);

  const aplicar = useMutation({
    mutationFn: async () => {
      const dados = {
        catalogo_id: catalogoId,
        ...dadosDoseAplicacao(dose),
        ...dadosLoteManual(lote, validadeLote, aplicadaEm || hojeISO()),
        aplicada_em: aplicadaEm,
        ...(aplicador ? { aplicador_id: aplicador } : {}),
        local_aplicacao: local,
        observacoes: obs,
        ...(semProxima ? { proxima_dose_em: "" } : proxima ? { proxima_dose_em: proxima } : {}),
      };
      if (agendamento) {
        const { data, error } = await supabase.rpc("clinica_vacina_aplicar", {
          p_agendamento_id: agendamento,
          p_dados: dados,
        });
        if (error) throw error;
        return data as unknown as Retorno;
      }
      if (!petId) throw new Error("Escolha o paciente");
      if (!aplicadaEm || aplicadaEm > hojeISO())
        throw new Error("A aplicação não pode ser no futuro");
      // Sem agendamento: cria o atendimento e registra o lote informado, sem baixa de estoque.
      const { data, error } = await supabase.rpc("clinica_vacina_offline", {
        p_chave: chave,
        p_acao: "aplicar",
        p_dados: {
          ...dados,
          pet_id: petId,
          ...dadosServicoCobrado(servicoAtual),
          aplicada_em: aplicadaEm,
        },
      });
      if (error) throw error;
      return data as unknown as Retorno;
    },
    onSuccess: (r) => {
      toast.success(`${rotuloDose(r.dose_tipo, r.dose_numero)} registrada`, {
        description: r.proxima_dose_em
          ? `Próxima dose em ${dateBR(r.proxima_dose_em)}.`
          : "Sem próxima dose.",
      });
      for (const a of r.avisos ?? []) toast.warning(a);
      setLote("");
      setValidadeLote("");
      setLocal("");
      setObs("");
      setProxima("");
      setSemProxima(false);
      setDose("auto");
      setChave(crypto.randomUUID());
      if (!agendamento) setAvulso(false);
      void qc.invalidateQueries({ queryKey: ["clinica-cartao"] });
      void qc.invalidateQueries({ queryKey: ["clinica-lotes"] });
      void qc.invalidateQueries({ queryKey: ["pet-minha-agenda"] });
      void qc.invalidateQueries({ queryKey: ["clinica-historico", petId] });
      void qc.invalidateQueries({ queryKey: ["clinica-pacientes-atendidos"] });
    },
    onError: (e: Error) => toast.error("Não foi possível registrar", { description: e.message }),
  });

  const registrarExterna = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clinica_vacina_registrar_externa", {
        p_pet_id: petId as string,
        p_dados: {
          catalogo_id: ext.catalogo,
          ...dadosDoseAplicacao(ext.dose),
          aplicada_em: ext.data,
          informado_por: ext.informado,
          lote: ext.lote,
          // em branco vale o protocolo do item
          ...(ext.proxima ? { proxima_dose_em: ext.proxima } : {}),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registrada como aplicada em outro local");
      setExterna(false);
      setExt({ catalogo: "", dose: "auto", data: hoje, informado: "", lote: "", proxima: "" });
      void qc.invalidateQueries({ queryKey: ["clinica-cartao"] });
    },
    onError: (e: Error) => toast.error("Não foi possível registrar", { description: e.message }),
  });

  const cancelar = useMutation({
    mutationFn: async () => {
      if (!cancelando) return;
      const { error } = await supabase.rpc("clinica_vacina_cancelar", {
        p_id: cancelando.id,
        p_motivo: cancelando.motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Aplicação cancelada");
      setCancelando(null);
      void qc.invalidateQueries({ queryKey: ["clinica-cartao"] });
      void qc.invalidateQueries({ queryKey: ["clinica-lotes"] });
    },
    onError: (e: Error) => toast.error("Não foi possível cancelar", { description: e.message }),
  });

  if (!petId)
    return (
      <EmptyState
        title="Nenhum paciente escolhido"
        description="Abra pelo atendimento de vacina da Minha agenda ou pela ficha do paciente."
        action={
          <Button asChild variant="outline">
            <Link to="/pet-minha-agenda">Ir para Minha agenda</Link>
          </Button>
        }
      />
    );

  const c = cartao.data;
  return (
    <div>
      <PageHeader
        title={embutido ? "Cartão vacinal" : `Vacinas e vermífugos${c ? ` de ${c.pet.nome}` : ""}`}
        {...(!embutido ? { description: c ? `Tutor(a) ${c.tutor}` : "Carregando…" } : {})}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/clinica-cartao" search={{ pet: petId }}>
                <Printer className="size-4" /> Carteirinha de vacinação
              </Link>
            </Button>
            {!agendamento && !avulso && (
              <Button onClick={() => setAvulso(true)}>
                <Syringe className="size-4" /> Aplicar vacina
              </Button>
            )}
            <Button variant="outline" onClick={() => setExterna(true)}>
              Aplicada em outro local
            </Button>
          </>
        }
      />

      {(agendamento || avulso) && (
        <div className="mb-4 grid gap-3 border-y border-border py-4">
          <h2 className="font-display text-base font-semibold">
            {agendamento ? "Registrar aplicação" : "Aplicação de vacina na clínica"}
          </h2>
          {!agendamento && (
            <p className="text-xs text-muted-foreground">
              Serviço de vacina: {servicos.data?.find((s) => s.id === servicoAtual)?.nome ?? "—"}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {!agendamento && (
              <>
                <div>
                  <Label htmlFor="a-servico">Serviço cobrado</Label>
                  <Select
                    value={servicoAtual || "__nenhum"}
                    onValueChange={(v) => setServicoId(v === "__nenhum" ? "" : v)}
                  >
                    <SelectTrigger id="a-servico">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__nenhum">Sem serviço cobrado</SelectItem>
                      {servicos.data?.map((sv) => (
                        <SelectItem key={sv.id} value={sv.id}>
                          {sv.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="a-data">
                    Data da aplicação <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="a-data"
                    type="date"
                    max={hoje}
                    value={aplicadaEm}
                    onChange={(e) => setAplicadaEm(e.target.value)}
                  />
                </div>
              </>
            )}
            <div>
              <Label htmlFor="a-item">
                Vacina ou vermífugo <span className="text-destructive">*</span>
              </Label>
              <Select
                value={catalogoId || "__nenhum"}
                onValueChange={(v) => {
                  setCatalogoId(v === "__nenhum" ? "" : v);
                  setDose("auto");
                  setLote("");
                  setValidadeLote("");
                }}
              >
                <SelectTrigger id="a-item">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nenhum">Escolha o item</SelectItem>
                  {catalogo.data?.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {item && (
                <p className="mt-1 text-xs text-muted-foreground">{resumoDoProtocolo(item)}</p>
              )}
            </div>
            <div>
              <Label htmlFor="a-dose">Dose aplicada</Label>
              <Select value={dose} onValueChange={setDose}>
                <SelectTrigger id="a-dose"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOSES_APLICACAO.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="a-lote">Lote</Label>
              <Input
                id="a-lote"
                value={lote}
                maxLength={120}
                onChange={(e) => setLote(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="a-validade">Vencimento do lote</Label>
              <Input
                id="a-validade"
                type="date"
                value={validadeLote}
                min={aplicadaEm || hoje}
                onChange={(e) => setValidadeLote(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="a-aplicador">
                Aplicado por <span className="text-destructive">*</span>
              </Label>
              <Select
                value={aplicador || "__eu"}
                onValueChange={(v) => setAplicador(v === "__eu" ? "" : v)}
              >
                <SelectTrigger id="a-aplicador">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__eu">Eu mesmo (veterinário)</SelectItem>
                  {aplicadores.data?.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome} (sob minha responsabilidade)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="a-local">
                Local da aplicação <span className="text-destructive">*</span>
              </Label>
              <Input
                id="a-local"
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                placeholder="Ex.: subcutânea, dorso"
              />
            </div>
            <div>
              <Label htmlFor="a-prox">Próxima dose</Label>
              <Input
                id="a-prox"
                type="date"
                disabled={semProxima}
                value={proxima}
                onChange={(e) => setProxima(e.target.value)}
              />
              <AtalhosProximaDose
                base={aplicadaEm || hoje}
                valor={proxima}
                desativado={semProxima}
                onEscolher={(d) => {
                  setProxima(d);
                  setSemProxima(false);
                }}
              />
              <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={semProxima}
                  onChange={(e) => setSemProxima(e.target.checked)}
                />
                Sem próxima dose
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                Em branco, vale o protocolo do item.
              </p>
            </div>
            <div>
              <Label htmlFor="a-obs">Observações</Label>
              <Input id="a-obs" value={obs} onChange={(e) => setObs(e.target.value)} />
            </div>
          </div>
          <div>
            <Button
              onClick={() => aplicar.mutate()}
              disabled={
                aplicar.isPending ||
                !catalogoId ||
                (Boolean(validadeLote) && validadeLote < (aplicadaEm || hoje)) ||
                !local.trim() ||
                (!agendamento && (!aplicadaEm || aplicadaEm > hoje))
              }
            >
              <Syringe className="size-4" /> Registrar aplicação
            </Button>
            {!agendamento && (
              <Button variant="ghost" className="ml-2" onClick={() => setAvulso(false)}>
                Fechar
              </Button>
            )}
          </div>
        </div>
      )}

      {c && catalogo.data && (
        <details className="mb-4 border-b border-border pb-3">
          <summary className="cursor-pointer text-sm font-semibold">Protocolos cadastrados</summary>
          <ul className="mt-2 grid gap-2 text-sm">
            {catalogo.data
              .filter((i) => i.especie === "todas" || i.especie === c.pet.especie)
              .map((i) => (
                <li key={i.id} className="min-w-0 break-words">
                  <strong>{i.nome}</strong> · {resumoDoProtocolo(i)}
                  {i.idade_minima_dias !== null && ` · idade mínima ${i.idade_minima_dias} dias`}
                </li>
              ))}
          </ul>
        </details>
      )}
      {c && c.proximas.length > 0 && (
        <section aria-label="Próximas doses" className="mb-4 border-y border-border py-3">
          <h3 className="mb-2 font-semibold">Próximas doses</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {c.proximas.map((dose) => {
              const dias = diasAte(dose.proxima_dose_em, hoje);
              return (
                <li
                  key={`${dose.nome}-${dose.proxima_dose_em}`}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 break-words font-medium">
                    {dose.nome} · {dateBR(dose.proxima_dose_em)}
                  </span>
                  <Badge
                    variant={
                      situacaoDaDose(dose.proxima_dose_em, hoje) === "atrasada"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {dias < 0
                      ? `${Math.abs(dias)} dia(s) de atraso`
                      : dias === 0
                        ? "Hoje"
                        : `Em ${dias} dia(s)`}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <h2 className="mb-2 font-display text-base font-semibold">
        Histórico de vacinas e vermífugos
      </h2>
      {cartao.isLoading ? (
        <div className="panel h-24 animate-pulse" />
      ) : cartao.error ? (
        <EmptyState title="Não foi possível abrir" description={(cartao.error as Error).message} />
      ) : (c?.aplicacoes ?? []).length === 0 ? (
        <EmptyState
          title="Nada registrado"
          description="As aplicações aparecem aqui e no cartão de vacinação."
        />
      ) : (
        <div className="grid gap-2">
          {c?.aplicacoes.map((a) => (
            <div
              key={a.id}
              className="panel flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div className="min-w-0 flex-1 break-words">
                <strong>{a.nome}</strong> · {rotuloDose(a.dose_tipo, a.dose_numero)} ·{" "}
                {dateBR(a.aplicada_em)}
                <span className="block text-xs text-muted-foreground">
                  {a.origem === "outro_local"
                    ? `Aplicada em outro local — informado por ${a.informado_por}`
                    : `Lote ${a.lote}${a.validade_lote ? ` (vence ${dateBR(a.validade_lote)})` : ""} · ${a.aplicador ?? a.veterinario} · resp. ${a.veterinario} (CRMV ${a.crmv}/${a.crmv_uf})`}
                  {a.proxima_dose_em
                    ? ` · próxima ${dateBR(a.proxima_dose_em)} · intervalo ${diasAte(a.proxima_dose_em, a.aplicada_em)} dias`
                    : " · sem próxima dose"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {a.origem === "outro_local" && <Badge variant="outline">Outro local</Badge>}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCancelando({ id: a.id, motivo: "" })}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={externa} onOpenChange={(o) => !o && setExterna(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aplicada em outro local</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="e-item">Vacina ou vermífugo</Label>
              <Select
                value={ext.catalogo || "__nenhum"}
                onValueChange={(v) => setExt({ ...ext, catalogo: v === "__nenhum" ? "" : v, dose: "auto" })}
              >
                <SelectTrigger id="e-item">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nenhum">Escolha o item</SelectItem>
                  {catalogo.data?.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="e-dose">Dose aplicada</Label>
              <Select value={ext.dose} onValueChange={(v) => setExt({ ...ext, dose: v })}>
                <SelectTrigger id="e-dose"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOSES_APLICACAO.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="e-data">Data</Label>
                <Input
                  id="e-data"
                  type="date"
                  max={hoje}
                  value={ext.data}
                  onChange={(e) => setExt({ ...ext, data: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-lote">Lote (se constar)</Label>
                <Input
                  id="e-lote"
                  value={ext.lote}
                  onChange={(e) => setExt({ ...ext, lote: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="e-info">Quem informou</Label>
              <Input
                id="e-info"
                value={ext.informado}
                onChange={(e) => setExt({ ...ext, informado: e.target.value })}
                placeholder="Ex.: carteira de vacinação, tutor, outra clínica"
              />
            </div>
            <div>
              <Label htmlFor="e-prox">Próxima dose</Label>
              <Input
                id="e-prox"
                type="date"
                value={ext.proxima}
                onChange={(e) => setExt({ ...ext, proxima: e.target.value })}
              />
              <AtalhosProximaDose
                base={ext.data || hoje}
                valor={ext.proxima}
                onEscolher={(d) => setExt({ ...ext, proxima: d })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Em branco, vale o protocolo do item.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Não baixa estoque; entra no cartão marcada “aplicada em outro local”.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExterna(false)}>
              Voltar
            </Button>
            <Button
              onClick={() => registrarExterna.mutate()}
              disabled={
                registrarExterna.isPending || !ext.catalogo || !ext.data || !ext.informado.trim()
              }
            >
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cancelando)} onOpenChange={(o) => !o && setCancelando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar aplicação</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="c-motivo">Motivo</Label>
            <Input
              id="c-motivo"
              value={cancelando?.motivo ?? ""}
              onChange={(e) =>
                cancelando && setCancelando({ ...cancelando, motivo: e.target.value })
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              O registro fica cancelado com o motivo. Lote e vencimento informados permanecem no
              histórico.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button
              onClick={() => cancelar.mutate()}
              disabled={cancelar.isPending || !cancelando?.motivo.trim()}
            >
              Cancelar aplicação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
