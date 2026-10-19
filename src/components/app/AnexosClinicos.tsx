import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Paperclip, Upload } from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  CATEGORIAS_ANEXO,
  TIPOS_ANEXO,
  erroDoArquivo,
  formatarTamanho,
  mimeDoArquivo,
  type AnexoClinico,
  type CategoriaAnexo,
} from "@/lib/anexos";
import { dateTimeBR } from "@/lib/format";
import { rotulo } from "@/lib/pet";

const BUCKET = "clinica-anexos";

/**
 * Anexos do exame ou do atendimento: imagem (ultrassom, raio-x), laudo em arquivo e exame laboratorial.
 * O arquivo fica em armazenamento privado; para ver, o sistema registra quem abriu e gera um link que dura 2 minutos.
 * Anexo não se troca nem se apaga: enviado por engano, é cancelado com motivo e continua no registro.
 */
export function AnexosClinicos({
  exameId,
  atendimentoId,
  podeEnviar = true,
}: {
  exameId?: string;
  atendimentoId?: string;
  podeEnviar?: boolean;
}) {
  const alvo = exameId ?? atendimentoId ?? "";
  const qc = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [categoria, setCategoria] = useState<CategoriaAnexo>("imagem");
  const [descricao, setDescricao] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [verCancelados, setVerCancelados] = useState(false);
  const [cancelando, setCancelando] = useState<AnexoClinico | null>(null);
  const [motivo, setMotivo] = useState("");

  const chave = ["clinica-anexos", alvo];

  const {
    data = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_anexos", {
        ...(exameId ? { p_exame_id: exameId } : {}),
        ...(atendimentoId ? { p_atendimento_id: atendimentoId } : {}),
      });
      if (error) throw error;
      return (data ?? []) as unknown as AnexoClinico[];
    },
  });

  const enviar = useMutation({
    mutationFn: async () => {
      if (!arquivo) throw new Error("Escolha o arquivo");
      const falha = erroDoArquivo(arquivo);
      if (falha) throw new Error(falha);
      const mime = mimeDoArquivo(arquivo) as string;
      const { data: res, error } = await supabase.rpc("clinica_anexo_preparar", {
        p_dados: {
          ...(exameId ? { exame_id: exameId } : { atendimento_id: atendimentoId }),
          categoria,
          descricao: descricao.trim(),
          nome_arquivo: arquivo.name,
          mime,
          tamanho: arquivo.size,
        },
      });
      if (error) throw error;
      const reserva = res as unknown as { id: string; caminho: string };
      const up = await supabase.storage
        .from(BUCKET)
        .upload(reserva.caminho, arquivo, { contentType: mime, upsert: false });
      if (up.error) throw up.error;
      const { error: erroConfirma } = await supabase.rpc("clinica_anexo_confirmar", {
        p_id: reserva.id,
      });
      if (erroConfirma) throw erroConfirma;
    },
    onSuccess: () => {
      toast.success("Anexo enviado");
      setDescricao("");
      setArquivo(null);
      if (entrada.current) entrada.current.value = "";
      void qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e: Error) => toast.error("Não foi possível enviar", { description: e.message }),
  });

  const abrir = useMutation({
    mutationFn: async (a: AnexoClinico) => {
      // abre a janela já, no clique, para o navegador não bloquear; o link chega logo em seguida
      const janela = window.open("about:blank", "_blank");
      try {
        const { data: info, error } = await supabase.rpc("clinica_anexo_abrir", { p_id: a.id });
        if (error) throw error;
        const caminho = (info as unknown as { caminho: string }).caminho;
        const { data: link, error: erroLink } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(caminho, 120);
        if (erroLink || !link) throw erroLink ?? new Error("Não foi possível gerar o link");
        if (janela) janela.location.href = link.signedUrl;
        else window.location.href = link.signedUrl;
      } catch (e) {
        janela?.close();
        throw e;
      }
    },
    onError: (e: Error) => toast.error("Não foi possível abrir", { description: e.message }),
  });

  const cancelar = useMutation({
    mutationFn: async () => {
      if (!cancelando) return;
      const { error } = await supabase.rpc("clinica_anexo_cancelar", {
        p_id: cancelando.id,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Anexo cancelado");
      setCancelando(null);
      setMotivo("");
      void qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e: Error) => toast.error("Não foi possível cancelar", { description: e.message }),
  });

  const visiveis = data.filter((a) => verCancelados || a.situacao === "ativo");
  const cancelados = data.filter((a) => a.situacao === "cancelado").length;
  const falhaArquivo = arquivo ? erroDoArquivo(arquivo) : null;

  return (
    <div className="panel grid gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <Paperclip className="size-4" /> Anexos
        </h4>
        {cancelados > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={verCancelados}
              onChange={(e) => setVerCancelados(e.target.checked)}
            />
            Mostrar cancelados ({cancelados})
          </label>
        )}
      </div>

      {isLoading ? (
        <div className="h-12 animate-pulse rounded-md bg-muted" />
      ) : error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : visiveis.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum anexo.</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {visiveis.map((a) => (
            <li
              key={a.id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 ${
                a.situacao === "cancelado" ? "opacity-70" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {a.descricao}{" "}
                  <Badge variant="outline">
                    {rotulo(CATEGORIAS_ANEXO, a.categoria).split(" (")[0]}
                  </Badge>
                  {a.situacao === "cancelado" && <Badge variant="outline">Cancelado</Badge>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {a.nome_arquivo} ·{" "}
                  {rotulo(
                    TIPOS_ANEXO.map((t) => ({ value: t.mime, label: t.rotulo })),
                    a.mime,
                  )}{" "}
                  · {formatarTamanho(a.tamanho)} · {a.veterinario} (CRMV {a.crmv}-{a.crmv_uf}) ·{" "}
                  {dateTimeBR(a.created_at)}
                </p>
                {a.situacao === "cancelado" && (
                  <p className="text-xs text-amber-800">
                    Cancelado em {dateTimeBR(a.cancelado_em)}: {a.cancelado_motivo}
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={abrir.isPending}
                  onClick={() => abrir.mutate(a)}
                >
                  <ExternalLink className="size-4" /> Abrir
                </Button>
                {a.situacao === "ativo" && podeEnviar && (
                  <Button variant="ghost" size="sm" onClick={() => setCancelando(a)}>
                    Cancelar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {podeEnviar && (
        <div className="grid gap-2 border-t pt-3">
          <p className="text-sm font-medium">Enviar anexo</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor={`an-cat-${alvo}`}>Tipo</Label>
              <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaAnexo)}>
                <SelectTrigger id={`an-cat-${alvo}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIAS_ANEXO.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`an-desc-${alvo}`}>Descrição</Label>
              <Input
                id={`an-desc-${alvo}`}
                maxLength={200}
                placeholder="Ultrassom abdominal, raio-x de tórax…"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor={`an-arq-${alvo}`}>Arquivo (JPEG, PNG ou PDF, até 15 MB)</Label>
            <Input
              id={`an-arq-${alvo}`}
              ref={entrada}
              type="file"
              accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
            {falhaArquivo && <p className="mt-1 text-xs text-destructive">{falhaArquivo}</p>}
          </div>
          <div>
            <Button
              onClick={() => enviar.mutate()}
              disabled={enviar.isPending || !arquivo || !!falhaArquivo || !descricao.trim()}
            >
              <Upload className="size-4" /> {enviar.isPending ? "Enviando…" : "Enviar"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            O arquivo fica guardado em área privada e não se troca nem se apaga. Para ver, o sistema
            registra quem abriu. DICOM não é aceito: exporte a imagem em JPEG ou PNG, ou em PDF.
          </p>
        </div>
      )}

      <Dialog open={!!cancelando} onOpenChange={(o) => !o && setCancelando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar anexo</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              {cancelando?.descricao}. O arquivo continua guardado e o cancelamento fica registrado
              com o motivo.
            </p>
            <Label htmlFor="an-motivo">Motivo</Label>
            <Textarea
              id="an-motivo"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelar.mutate()}
              disabled={cancelar.isPending || !motivo.trim()}
            >
              Cancelar o anexo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
