import type { CatalogStore } from "./store.js";
import { JsonCatalogStore } from "./stores/json.js";
import { PostgresCatalogStore } from "./stores/postgres.js";

export async function createStoreFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<CatalogStore> {
  if (env.DATABASE_URL) return new PostgresCatalogStore(env.DATABASE_URL);
  return JsonCatalogStore.open(env.GTM_CATALOG_PATH ?? "./data/catalog.json");
}
