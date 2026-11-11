import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

/** Casca das páginas do portal do tutor: leve, para celular, sem o menu da clínica. */
export function PortalShell({ children, sair = true }: { children: ReactNode; sair?: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function encerrar() {
    await supabase.auth.signOut();
    // nada do tutor fica em memória no aparelho depois de sair
    qc.clear();
    void navigate({ to: "/portal/entrar" });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
          <Link to="/portal" className="text-base font-semibold">
            Portal do tutor
          </Link>
          {sair && (
            <Button size="sm" variant="ghost" onClick={() => void encerrar()}>
              <LogOut className="size-4" /> Sair
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">{children}</main>
      <footer className="mx-auto max-w-2xl px-4 pb-8 text-xs text-muted-foreground">
        Estas informações foram registradas e liberadas pela clínica. O portal não interpreta
        resultados nem substitui a orientação do veterinário: em caso de dúvida, fale com a clínica.
      </footer>
    </div>
  );
}
