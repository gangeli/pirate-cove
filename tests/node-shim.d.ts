// The project has no Node type definitions; tests that read baked assets from disk only need these.
declare module 'node:fs' {
  const fs: { readdirSync(p: string): string[]; existsSync(p: string): boolean; readFileSync(p: string): Uint8Array & { readUInt32LE(o: number): number; toString(enc?: string, s?: number, e?: number): string }; statSync(p: string): { mtimeMs: number; size: number } };
  export default fs;
}
declare module 'node:path' {
  const path: { resolve(...p: string[]): string; join(...p: string[]): string; basename(p: string): string };
  export default path;
}
declare const __dirname: string;
