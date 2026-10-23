// Complete each mutation and its UI update before starting the next one.
// Otherwise an older full-lead response can undo a newer confirmed hide in the UI.
export function createLeadMutationQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    // A failed request must not prevent a subsequent action from being saved.
    tail = result.catch(() => undefined);
    return result;
  };
}
