/* eslint-disable @typescript-eslint/no-explicit-any -- cliente Supabase injetado pelo middleware de autenticação */
// Middleware das funções de servidor: igual a requireSupabaseAuth, mas recusa quem tem o papel de contador.
// Várias funções usam a chave de serviço ou a conta compartilhada do emissor depois de conferir só a conta (tenant);
// o contador nunca deve chegar nelas. As únicas funções que ele usa estão em contador.functions.ts.
import { createMiddleware } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recusarContador } from "./contador-escopo.ts";

const semContador = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    await recusarContador((context as any).supabase);
    return next();
  });

export { semContador as requireSupabaseAuth };
