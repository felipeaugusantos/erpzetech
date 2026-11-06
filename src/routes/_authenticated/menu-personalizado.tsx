import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { useMenuBase } from "@/components/app/menu-base-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSessionData } from "@/hooks/useSessionData";
import {
  useMenuPersonalizado,
  useRestaurarMenu,
  useSalvarMenu,
} from "@/lib/menu-personalizado-dados";
import {
  adicionarAreaPropria,
  alternarOculto,
  assinatura,
  conferirConfig,
  ehEssencial,
  excluirAreaPropria,
  layoutParaConfig,
  montarLayout,
  moverArea,
  moverItem,
  moverItemParaArea,
  renomearAreaPropria,
  type LayoutEditor,
} from "@/lib/menu-personalizado-editor";

export const Route = createFileRoute("/_authenticated/menu-personalizado")({
  head: () => ({
    meta: [
      { title: "Menu da empresa — EZRA ERP" },
      {
        name: "description",
        content: "Esconda, mova e reordene as telas do menu e crie suas próprias áreas.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MenuDaEmpresa,
});

function MenuDaEmpresa() {
  const { data: sessao, isLoading: sessaoCarregando } = useSessionData();
  const base = useMenuBase();
  const gestao = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  if (sessaoCarregando) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!gestao)
    return (
      <EmptyState
        title="Só a administração organiza o menu"
        description="Peça ao administrador ou ao gestor da empresa."
      />
    );
  if (!base) return <p className="text-sm text-muted-foreground">Carregando o menu…</p>;
  return <Editor base={base} />;
}

function Editor({ base }: { base: NonNullable<ReturnType<typeof useMenuBase>> }) {
  const consulta = useMenuPersonalizado();
  const salvar = useSalvarMenu();
  const restaurar = useRestaurarMenu();
  const salva = consulta.data ?? null;
  const [layout, setLayout] = useState<LayoutEditor | null>(null);
  const [nomeNovo, setNomeNovo] = useState("");
  const [excluir, setExcluir] = useState<string | null>(null);
  const [confirmaRestaurar, setConfirmaRestaurar] = useState(false);

  // o desenho parte do que está salvo; depois de salvar ou restaurar, recomeça dele
  const desenhoSalvo = useMemo(() => montarLayout(base, salva), [base, salva]);
  useEffect(() => {
    if (!consulta.isLoading) setLayout(desenhoSalvo);
  }, [consulta.isLoading, desenhoSalvo]);

  if (!layout) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const alterado = assinatura(layout, base) !== assinatura(desenhoSalvo, base);
  const ocupado = salvar.isPending || restaurar.isPending;
  const mudar = (novo: LayoutEditor) => setLayout(novo);

  function aplicarResultado(r: ReturnType<typeof adicionarAreaPropria>, aoDarCerto?: () => void) {
    if (!r.ok) {
      toast.error(r.erro);
      return;
    }
    mudar(r.layout);
    aoDarCerto?.();
  }

  function gravar() {
    const config = conferirConfig(layoutParaConfig(layout!, base));
    if (!config) {
      toast.error("O menu ficou grande demais ou fora do formato. Simplifique e tente de novo.");
      return;
    }
    salvar.mutate(config, {
      onSuccess: () =>
        toast.success("Menu salvo", { description: "Vale para todas as pessoas da empresa." }),
      onError: (e: Error) => toast.error(e.message),
    });
  }

  return (
    <>
      <PageHeader
        title="Menu da empresa"
        description="Esconda telas, mude a ordem, mova entre áreas e crie suas próprias áreas. Vale para todas as pessoas da empresa."
        actions={
          <>
            <Button
              variant="outline"
              disabled={!alterado || ocupado}
              onClick={() => setLayout(desenhoSalvo)}
            >
              <Undo2 className="size-4" /> Descartar alterações
            </Button>
            <Button disabled={!alterado || ocupado} onClick={gravar}>
              <Save className="size-4" /> {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </>
        }
      />

      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        Isto só muda como o menu aparece. Cada pessoa continua vendo apenas as telas que o perfil
        dela permite. Esconder não bloqueia a tela: ela ainda abre por atalhos dentro de outras
        telas e pelo endereço. Telas novas do sistema aparecem sozinhas no fim da área.
      </p>

      <div className="mb-6 flex max-w-xl flex-wrap items-center gap-2">
        <Input
          value={nomeNovo}
          onChange={(e) => setNomeNovo(e.target.value)}
          placeholder="Nome de uma nova área"
          aria-label="Nome de uma nova área"
          maxLength={30}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              aplicarResultado(adicionarAreaPropria(layout, nomeNovo), () => setNomeNovo(""));
            }
          }}
        />
        <Button
          variant="outline"
          disabled={ocupado}
          onClick={() =>
            aplicarResultado(adicionarAreaPropria(layout, nomeNovo), () => setNomeNovo(""))
          }
        >
          <Plus className="size-4" /> Criar área
        </Button>
        <Button variant="ghost" disabled={ocupado} onClick={() => setConfirmaRestaurar(true)}>
          <RotateCcw className="size-4" /> Restaurar o padrão
        </Button>
      </div>

      <div className="space-y-4">
        {layout.map((area, posicao) => (
          <section key={area.chave} className="panel p-4" aria-label={`Área ${area.nome}`}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {area.propria ? (
                <NomeEditavel
                  nome={area.nome}
                  onConfirmar={(nome) =>
                    aplicarResultado(renomearAreaPropria(layout, area.chave, nome))
                  }
                />
              ) : (
                <h2 className="font-display text-base font-semibold">{area.nome}</h2>
              )}
              {area.propria && <Badge variant="secondary">Sua área</Badge>}
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Subir a área ${area.nome}`}
                  disabled={posicao === 0 || ocupado}
                  onClick={() => mudar(moverArea(layout, area.chave, -1))}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Descer a área ${area.nome}`}
                  disabled={posicao === layout.length - 1 || ocupado}
                  onClick={() => mudar(moverArea(layout, area.chave, 1))}
                >
                  <ArrowDown className="size-4" />
                </Button>
                {area.propria && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir a área ${area.nome}`}
                    disabled={ocupado}
                    onClick={() => setExcluir(area.chave)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>

            {area.itens.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma tela nesta área.</p>
            ) : (
              <ul className="divide-y">
                {area.itens.map((item, i) => (
                  <li key={item.to} className="flex flex-wrap items-center gap-2 py-2">
                    <span className={item.oculto ? "text-muted-foreground line-through" : ""}>
                      {item.label}
                    </span>
                    {item.oculto && <Badge variant="outline">Escondida</Badge>}
                    <div className="ml-auto flex flex-wrap items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Subir ${item.label}`}
                        disabled={i === 0 || ocupado}
                        onClick={() => mudar(moverItem(layout, item.to, -1))}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Descer ${item.label}`}
                        disabled={i === area.itens.length - 1 || ocupado}
                        onClick={() => mudar(moverItem(layout, item.to, 1))}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Select
                        value=""
                        onValueChange={(destino) =>
                          mudar(moverItemParaArea(layout, item.to, destino))
                        }
                      >
                        <SelectTrigger
                          className="h-9 w-44"
                          aria-label={`Mover ${item.label} para outra área`}
                        >
                          <SelectValue placeholder="Mover para…" />
                        </SelectTrigger>
                        <SelectContent>
                          {layout
                            .filter((a) => a.chave !== area.chave)
                            .map((a) => (
                              <SelectItem key={a.chave} value={a.chave}>
                                {a.nome}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${item.oculto ? "Mostrar" : "Esconder"} ${item.label}`}
                        title={
                          ehEssencial(item.to)
                            ? "Esta tela não pode ser escondida, para você sempre conseguir desfazer."
                            : item.oculto
                              ? "Mostrar no menu"
                              : "Esconder do menu"
                        }
                        disabled={ehEssencial(item.to) || ocupado}
                        onClick={() => mudar(alternarOculto(layout, item.to))}
                      >
                        {item.oculto ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <AlertDialog open={excluir !== null} onOpenChange={(o) => !o && setExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta área?</AlertDialogTitle>
            <AlertDialogDescription>
              As telas que estão nela voltam para a área de origem. Nada é apagado do sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (excluir) mudar(excluirAreaPropria(layout, excluir, base));
                setExcluir(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmaRestaurar} onOpenChange={setConfirmaRestaurar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Voltar ao menu padrão?</AlertDialogTitle>
            <AlertDialogDescription>
              Apaga a organização salva e todas as pessoas voltam a ver o menu do sistema. Isso vale
              para a empresa inteira.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restaurar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={restaurar.isPending}
              onClick={(e) => {
                e.preventDefault();
                restaurar.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmaRestaurar(false);
                    toast.success("Menu padrão restaurado");
                  },
                  onError: (err: Error) => toast.error(err.message),
                });
              }}
            >
              {restaurar.isPending ? "Restaurando…" : "Restaurar o padrão"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Nome de uma área própria: edita no lugar e confirma ao sair do campo ou com Enter. */
function NomeEditavel({
  nome,
  onConfirmar,
}: {
  nome: string;
  onConfirmar: (nome: string) => void;
}) {
  const [texto, setTexto] = useState(nome);
  useEffect(() => setTexto(nome), [nome]);
  const confirmar = () => {
    if (texto.trim() !== nome) onConfirmar(texto);
  };
  return (
    <Input
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          confirmar();
        }
      }}
      maxLength={30}
      aria-label={`Nome da área ${nome}`}
      className="h-9 w-56 font-semibold"
    />
  );
}
