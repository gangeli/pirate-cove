// Path worker: long A* searches off the main thread. The protocol and the main thread's side are in
// pathservice.ts; the search itself is PathMirror (path.ts), the same PathFinder code the sim runs.
import { PathMirror, type PathRequestMsg } from './path';

const mirror = new PathMirror();
// the project compiles against the DOM lib, not the worker lib: just the two members used here
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<PathRequestMsg>) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
};
scope.onmessage = (e) => {
  const r = mirror.handle(e.data);
  if (r) scope.postMessage(r, r.path ? [r.path.buffer] : []);
};
