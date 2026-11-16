// Process-wide behaviour that index.ts installs at startup.

/**
 * A promise that rejects with nobody waiting on it would end the process (Node's default), taking
 * every running turn and the job runner with it. With this handler the rejection is logged and
 * the server keeps serving. Returns a function that removes the handler.
 */
export function logUnhandledRejections(log: (message: string, reason: unknown) => void = console.error): () => void {
  const onRejection = (reason: unknown) => log('unhandled promise rejection', reason);
  process.on('unhandledRejection', onRejection);
  return () => void process.off('unhandledRejection', onRejection);
}
