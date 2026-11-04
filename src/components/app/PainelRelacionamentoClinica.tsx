import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  LIMITE_LINHAS_PAINEL,
  MINUTOS_CONFERIR,
  percentual,
  resumirMensagens,
  separarContatos,
  type LinhaContato,
  type LinhaMensagem,
  type MensagemDeOrigem,
} from "@/lib/relacionamento-clinica";
import { cn } from "@/lib/utils";

const PERIODOS = [
  { dias: "7", rotulo: "Últimos 7 dias" },
  { dias: "30", rotulo: "Últimos 30 dias" },
  { dias: "90", rotulo: "Últimos 90 dias" },
];

function Cartao({
  titulo,
  valor,
  nota,
  alerta,
}: {
  titulo: string;
  valor: number;
  nota?: string;
  alerta?: boolean;
}) {
  return (
    <div className={cn("panel p-3", alerta && valor > 0 && "border-destructive/50")}>
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className="text-2xl font-semibold tabular-nums">{valor.toLocaleString("pt-BR")}</div>
      {nota && <div className="mt-1 text-xs text-muted-foreground">{nota}</div>}
    </div>
  );
}

/**
 * Resultado dos lembretes da clínica com o que cada estado PROVA: "serviço aceitou" não é entrega, abrir o
 * link do WhatsApp não é mensagem enviada, e nenhuma conta liga o lembrete a um retorno. Só leitura.
 */
export function PainelRelacionamentoClinica() {
  const [dias, setDias] = useState("30");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["clinica-relacionamento", dias],
    refetchInterval: 60_000,
    queryFn: async () => {
      const desde = new Date(Date.now() - Number(dias) * 86_400_000).toISOString();
      const [msgs, origem, contatos] = await Promise.all([
        // funil: lembretes criados no período
        supabase
          .from("wa_mensagens")
          .select("tipo, situacao, origem, erro, tentativas, referencia, updated_at")
          .in("tipo", ["reforco_vacina", "retorno_consulta"])
          .gte("created_at", desde)
          .order("created_at", { ascending: false })
          .limit(LIMITE_LINHAS_PAINEL),
        // origem dos contatos: avisos aceitos ou confirmados no período, mesmo os criados antes dele
        supabase
          .from("wa_mensagens")
          .select("tipo, situacao, referencia")
          .eq("tipo", "reforco_vacina")
          .in("situacao", ["enviada", "entregue", "lida"])
          .gte("updated_at", desde)
          .order("updated_at", { ascending: false })
          .limit(LIMITE_LINHAS_PAINEL),
        supabase
          .from("pet_contatos")
          .select("pet_id, referencia, canal")
          .eq("tipo", "reforco")
          .gte("contatado_em", desde)
          .limit(LIMITE_LINHAS_PAINEL),
      ]);
      if (msgs.error) throw msgs.error;
      if (origem.error) throw origem.error;
      if (contatos.error) throw contatos.error;
      return {
        mensagens: (msgs.data ?? []) as unknown as LinhaMensagem[],
        origem: (origem.data ?? []) as unknown as MensagemDeOrigem[],
        contatos: (contatos.data ?? []) as unknown as LinhaContato[],
      };
    },
  });

  const r = data ? resumirMensagens(data.mensagens) : null;
  const c = data ? separarContatos(data.contatos, data.origem) : null;
  const cortado =
    !!data &&
    (data.mensagens.length >= LIMITE_LINHAS_PAINEL ||
      data.origem.length >= LIMITE_LINHAS_PAINEL ||
      data.contatos.length >= LIMITE_LINHAS_PAINEL);
  const pctEntrega = r ? percentual(r.entregues, r.aceitas) : null;

  return (
    <section className="mb-6 space-y-3" aria-labelledby="titulo-resultado">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="titulo-resultado" className="text-sm font-semibold">
          Resultado dos lembretes
        </h2>
        <Select value={dias} onValueChange={setDias}>
          <SelectTrigger className="w-44" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODOS.map((p) => (
              <SelectItem key={p.dias} value={p.dias}>
                {p.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <div className="panel h-24 animate-pulse" />}
      {isError && (
        <p className="panel p-3 text-sm text-destructive">Não foi possível carregar o resultado.</p>
      )}

      {r && c && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <Cartao
              titulo="Na fila"
              valor={r.naFila}
              nota={`${r.aguardandoNovaTentativa} esperando nova tentativa`}
            />
            <Cartao titulo="Tentativa feita" valor={r.tentadas} />
            <Cartao titulo="Serviço aceitou" valor={r.aceitas} nota="Não garante entrega" />
            <Cartao
              titulo="Entrega confirmada"
              valor={r.entregues}
              nota={pctEntrega === null ? "—" : `${pctEntrega}% das aceitas`}
            />
            <Cartao titulo="Lidas" valor={r.lidas} />
            <Cartao titulo="Falhas" valor={r.falhas} alerta />
            <Cartao titulo="Canceladas" valor={r.canceladas} />
          </div>

          {r.conferir > 0 && (
            <p className="panel border-destructive/50 p-3 text-sm" role="status">
              {r.conferir} lembrete(s) em tentativa há mais de {MINUTOS_CONFERIR} minutos: o envio
              pode ter saído sem o resultado gravado. Confira no WhatsApp da empresa antes de
              reenviar.
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="panel space-y-1 p-3 text-sm">
              <h3 className="font-medium">Contatos feitos pela recepção (vacina e vermífugo)</h3>
              <p>
                Abriu o WhatsApp: <strong>{c.abriuWhatsApp}</strong>
                <span className="block text-xs text-muted-foreground">
                  O sistema não sabe se a mensagem foi escrita e enviada.
                </span>
              </p>
              <p>
                Ligou ou outro canal (“Já falei”): <strong>{c.declaradoPelaRecepcao}</strong>
                <span className="block text-xs text-muted-foreground">
                  Declarado pela recepção.
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Coincidem com um aviso aceito pelo sistema: {c.coincideComAviso}. Não dá para saber
                se foram gravados pelo sistema ou pela recepção antes dele.
              </p>
            </div>
            <div className="panel space-y-1 p-3 text-sm">
              <h3 className="font-medium">Falhas por motivo</h3>
              {r.motivosDeFalha.length === 0 ? (
                <p className="text-muted-foreground">Nenhuma falha no período.</p>
              ) : (
                <ul className="space-y-1">
                  {r.motivosDeFalha.map((m) => (
                    <li key={m.motivo} className="flex justify-between gap-3">
                      <span className="break-words">{m.motivo}</span>
                      <strong className="tabular-nums">{m.quantidade}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {r.automaticas} automáticos e {r.pedidasPelaRecepcao} pedidos pela recepção (enviados
            pelo sistema). Entrega e leitura só aparecem quando o WhatsApp confirma. Este painel não
            mostra retorno gerado pelo lembrete: isso depende de uma regra de atribuição a definir
            com a gestão. Tutor que não aceita mensagens ou pediu SAIR não entra na fila e, por
            enquanto, esse bloqueio não é registrado.
            {cortado && ` Mostrando só os ${LIMITE_LINHAS_PAINEL} registros mais recentes.`}
          </p>
        </>
      )}
    </section>
  );
}
