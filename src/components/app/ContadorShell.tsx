import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { FileText, LogOut, Percent } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Moldura do contador: só os XMLs e, se a empresa liberou, a parte tributária. Não usa o menu completo
 * (o contador não tem as outras áreas; o banco recusa mesmo que alguém abra o endereço).
 */
export function ContadorShell({
  children,
  editaTributos,
}: {
  children: ReactNode;
  editaTributos: boolean;
}) {
  async function sair() {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  }
  return (
    <div className="min-h-screen bg-background">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <nav className="flex flex-wrap items-center gap-1" aria-label="Área do contador">
          <span className="mr-3 font-display text-sm font-bold">EZRA · Contador</span>
          <Button asChild variant="ghost" size="sm">
            <Link to="/contador">
              <FileText className="mr-2 size-4" /> XMLs das notas
            </Link>
          </Button>
          {editaTributos && (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link to="/tributos-aprox">
                  <Percent className="mr-2 size-4" /> Tributos aproximados
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/fiscal-regras">
                  <Percent className="mr-2 size-4" /> Regras fiscais
                </Link>
              </Button>
            </>
          )}
        </nav>
        <Button variant="outline" size="sm" onClick={sair}>
          <LogOut className="mr-2 size-4" /> Sair
        </Button>
      </header>
      <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
