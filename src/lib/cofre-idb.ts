// Armazém do cofre da clínica no IndexedDB do navegador (só guarda registros já cifrados; ver cofre.ts).
import type { Armazem } from "@/lib/cofre";

const BANCO = "zt-cofre-clinica";
const LOJAS = ["meta", "fila", "copia"] as const;

let aberto: Promise<IDBDatabase> | null = null;

function abrirBanco(): Promise<IDBDatabase> {
  aberto ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(BANCO, 1);
    req.onupgradeneeded = () => {
      for (const loja of LOJAS) {
        if (!req.result.objectStoreNames.contains(loja)) req.result.createObjectStore(loja);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      aberto = null;
      reject(req.error ?? new Error("Não foi possível abrir o armazenamento deste navegador"));
    };
  });
  return aberto;
}

function esperar<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Falha no armazenamento do navegador"));
  });
}

function concluir(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Falha no armazenamento do navegador"));
    tx.onabort = () => reject(tx.error ?? new Error("Gravação cancelada pelo navegador"));
  });
}

export function armazemIndexedDb(): Armazem {
  return {
    async ler(loja, chave) {
      const db = await abrirBanco();
      return esperar(db.transaction(loja, "readonly").objectStore(loja).get(chave));
    },
    async gravar(loja, chave, valor) {
      const db = await abrirBanco();
      const tx = db.transaction(loja, "readwrite");
      tx.objectStore(loja).put(valor, chave);
      await concluir(tx);
    },
    async apagar(loja, chave) {
      const db = await abrirBanco();
      const tx = db.transaction(loja, "readwrite");
      tx.objectStore(loja).delete(chave);
      await concluir(tx);
    },
    async listar(loja) {
      const db = await abrirBanco();
      const store = db.transaction(loja, "readonly").objectStore(loja);
      const [chaves, valores] = await Promise.all([
        esperar(store.getAllKeys()),
        esperar(store.getAll()),
      ]);
      return chaves.map((c, i) => [String(c), valores[i]] as [string, unknown]);
    },
    async limpar() {
      const db = await abrirBanco();
      const tx = db.transaction([...LOJAS], "readwrite");
      for (const loja of LOJAS) tx.objectStore(loja).clear();
      await concluir(tx);
    },
  };
}
