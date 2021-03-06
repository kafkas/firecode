import { sleep, PromiseQueue, registerInterval } from '../utils';
import type {
  BatchCallback,
  ExitEarlyPredicate,
  Traversable,
  TraversalConfig,
  TraversalResult,
  Traverser,
} from '../api';
import { AbstractTraverser } from './abstract';

/**
 * Computes the duration (in ms) for which to sleep before re-running the queue processing logic.
 *
 * @param traversalConfig - Traversal config.
 * @param queueSize - The current size of the queue.
 * @returns A non-negative integer.
 */
function getProcessQueueInterval(traversalConfig: TraversalConfig, queueSize: number): number {
  // TODO: Implement
  return 250;
}

/**
 * Computes the number of queue items to process based on the traversal configuration and queue size.
 *
 * @param traversalConfig - Traversal config.
 * @param queueSize - The current size of the queue.
 * @returns An integer within the range [0, `queueSize`].
 */
function getProcessableItemCount(traversalConfig: TraversalConfig, queueSize: number): number {
  // TODO: Implement
  return queueSize;
}

export class PromiseQueueBasedTraverserImpl<D>
  extends AbstractTraverser<D>
  implements Traverser<D> {
  static readonly #defaultConfig: TraversalConfig = {
    ...AbstractTraverser.baseConfig,
  };

  public constructor(
    public readonly traversable: Traversable<D>,
    exitEarlyPredicates: ExitEarlyPredicate<D>[] = [],
    config?: Partial<TraversalConfig>
  ) {
    super({ ...PromiseQueueBasedTraverserImpl.#defaultConfig, ...config }, exitEarlyPredicates);
  }

  public withConfig(config: Partial<TraversalConfig>): Traverser<D> {
    return new PromiseQueueBasedTraverserImpl(this.traversable, this.exitEarlyPredicates, {
      ...this.traversalConfig,
      ...config,
    });
  }

  public withExitEarlyPredicate(predicate: ExitEarlyPredicate<D>): Traverser<D> {
    return new PromiseQueueBasedTraverserImpl(
      this.traversable,
      [...this.exitEarlyPredicates, predicate],
      this.traversalConfig
    );
  }

  public async traverse(callback: BatchCallback<D>): Promise<TraversalResult> {
    const { traversalConfig } = this;
    const { maxConcurrentBatchCount } = traversalConfig;

    if (maxConcurrentBatchCount === 1) {
      return this.runTraversal(async (batchDocs, batchIndex) => {
        await callback(batchDocs, batchIndex);
      });
    }

    const callbackPromiseQueue = new PromiseQueue<void>();

    const unregisterQueueProcessor = registerInterval(
      async () => {
        if (!callbackPromiseQueue.isProcessing) {
          const processableItemCount = getProcessableItemCount(
            traversalConfig,
            callbackPromiseQueue.size
          );
          await callbackPromiseQueue.processFirst(processableItemCount);
        }
      },
      () => getProcessQueueInterval(traversalConfig, callbackPromiseQueue.size)
    );

    const traversalResult = await this.runTraversal((batchDocs, batchIndex) => {
      callbackPromiseQueue.enqueue(callback(batchDocs, batchIndex) ?? Promise.resolve());
      return async () => {
        while (callbackPromiseQueue.size >= maxConcurrentBatchCount) {
          // TODO: The sleep time is currently set to processQueueInterval but there may be a better way
          // to compute sleep duration.
          const processQueueInterval = getProcessQueueInterval(
            traversalConfig,
            callbackPromiseQueue.size
          );
          await sleep(processQueueInterval);
        }
      };
    });

    await unregisterQueueProcessor();

    // There may still be some Promises left in the queue but there won't be any new ones coming in.
    // Wait for the existing ones to resolve and exit.
    await callbackPromiseQueue.processAll();

    return traversalResult;
  }
}
