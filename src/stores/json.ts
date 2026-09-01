import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CatalogBundle } from "../types.js";
import { MemoryCatalogStore } from "./memory.js";

export class JsonCatalogStore extends MemoryCatalogStore {
  static async open(path: string) {
    const raw = await readFile(resolve(path), "utf8");
    return new JsonCatalogStore(JSON.parse(raw) as CatalogBundle);
  }
}
