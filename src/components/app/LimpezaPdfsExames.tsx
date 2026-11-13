import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { limparPdfsExcluidos } from "@/lib/exame-exclusao.functions";
import { Button } from "@/components/ui/button";

export function LimpezaPdfsExames() {
  const limpar = useServerFn(limparPdfsExcluidos);
  const [pendente, setPendente] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const tentar = useCallback(async () => {
    setOcupado(true);
    try { setPendente((await limpar()).pendentes > 0); }
    catch { setPendente(true); }
    finally { setOcupado(false); }
  }, [limpar]);
  useEffect(() => { void tentar(); }, [tentar]);
  return pendente ? <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
    <span>Limpeza dos PDFs de exames excluídos pendente.</span>
    <Button variant="outline" disabled={ocupado} onClick={() => void tentar()}>Tentar novamente</Button>
  </div> : null;
}