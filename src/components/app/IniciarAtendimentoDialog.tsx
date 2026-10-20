import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  dadosDaVisitaAvulsa,
  servicoInicial,
  servicosDaResposta,
  type DadosVisitaAvulsa,
} from "@/lib/iniciar-atendimento";
import { ehErroDeRede } from "@/lib/offline";

/**
 * Abre o atendimento de um paciente que chegou sem consulta marcada: cria a consulta e o atendimento de uma vez e leva à tela de atendimento.
 * Sem sinal, o caminho é o Trabalho sem internet, que guarda e envia depois.
 */
export function IniciarAtendimentoDialog({
  petId,
  petNome,
  aoIniciar,
  aoFechar,
}: {
  petId: string;
  petNome: string;
  /** Recebe o id da consulta criada (a tela de atendimento abre por ele). */
  aoIniciar: (agendamentoId: string) => void;
  aoFechar: () => void;
}) {
  const [servico, setServico] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // o mesmo pedido repetido leva os mesmos identificadores: o banco não abre dois atendimentos
  const tentativa = useRef<{ chave: string; dados: DadosVisitaAvulsa } | null>(null);

  const servicos = useQuery({
    queryKey: ["clinica-servicos-consulta"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_servicos_consulta");
      if (error) throw error;
      return servicosDaResposta(data);
    },
  });

  const lista = servicos.data ?? [];
  const escolhido = servico ?? servicoInicial(lista);

  async function iniciar() {
    if (!escolhido) return;
    setSalvando(true);
    try {
      if (
        tentativa.current?.dados.servico_id !== escolhido ||
        tentativa.current.dados.pet_id !== petId
      )
        tentativa.current = {
          chave: crypto.randomUUID(),
          dados: dadosDaVisitaAvulsa(petId, escolhido),
        };
      const { chave, dados } = tentativa.current;
      const { data, error } = await supabase.rpc("clinica_visita_registrar", {
        p_chave: chave,
        p_dados: dados,
      });
      if (error) throw error;
      aoIniciar(String((data as unknown as { agendamento_id: string }).agendamento_id));
    } catch (e) {
      const msg = (e as Error).message;
      if (ehErroDeRede(msg))
        toast.error("Sem internet", {
          description: "Use Trabalho sem internet: ele guarda o atendimento e envia depois.",
        });
      else toast.error("Não foi possível iniciar o atendimento", { description: msg });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !salvando && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Iniciar atendimento de {petNome}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Para o paciente que chegou sem consulta marcada. Cria a consulta com o preço cadastrado
          para o serviço e abre o atendimento agora.
        </p>
        {servicos.isLoading ? (
          <div className="h-10 animate-pulse rounded-md bg-muted" />
        ) : servicos.error ? (
          <p className="text-sm text-destructive">{(servicos.error as Error).message}</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum serviço de consulta ativo: peça à gestão para cadastrar em Serviços do pet.
          </p>
        ) : (
          <div>
            <Label htmlFor="ia-servico">Serviço de consulta</Label>
            <Select value={escolhido} onValueChange={setServico}>
              <SelectTrigger id="ia-servico">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {lista.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={() => void iniciar()} disabled={!escolhido || salvando}>
            {salvando ? "Abrindo…" : "Iniciar atendimento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
