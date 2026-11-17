import { DateTime, Effect } from "effect";
import { Saga } from "@golemcloud/effect-golem";
import { orDieRpc } from "../../common/index.js";
import { InsufficientInventoryError } from "./inventory-schema.js";
import { InventoryAgent } from "./inventory-agent.js";

export interface ReservationItem {
  readonly productId: string;
  readonly quantity: number;
}

/**
 * Atomically reserves inventory across multiple items.
 * If any item reservation fails (e.g. out of stock), all previously
 * acquired reservations in this transaction are automatically rolled back
 * in reverse order via Saga compensations.
 */
export const reserveItemsSaga = ({
  orderId,
  region,
  items,
  expiresAt,
}: {
  readonly orderId: string;
  readonly region: string;
  readonly items: ReadonlyArray<ReservationItem>;
  readonly expiresAt?: DateTime.Utc;
}) =>
  Saga.fallibleTransaction(
    Effect.forEach(
      items,
      (item) =>
        Effect.gen(function* () {
          const invClient = yield* InventoryAgent.client
            .get({ id: item.productId })
            .pipe(Effect.orDie);

          yield* Saga.withFallibleCompensation(
            invClient
              .reserveQuantity({
                orderId,
                region,
                quantity: item.quantity,
                expiresAt,
              })
              .pipe(
                Effect.catchTag("inventory-not-found", (err) =>
                  Effect.fail({
                    _tag: "insufficient-inventory" as const,
                    message: err.message,
                    productId: item.productId,
                    region,
                    requested: item.quantity,
                    available: 0,
                  }),
                ),
                orDieRpc,
              ),
            () => invClient.releaseReservation.trigger({ orderId }).pipe(Effect.asVoid),
          );
        }),
      { discard: true },
    ),
  ).pipe(
    Effect.catchTag("NestedSagaError", (err) => Effect.die(err)),
    Effect.catchTag("FailedAndRolledBackCompletely", (failure) => {
      const err = failure.error as InsufficientInventoryError;
      return Effect.fail(err);
    }),
    Effect.catchTag("FailedAndRolledBackPartially", (failure) => {
      const err = failure.error as InsufficientInventoryError;
      return Effect.logWarning(
        `Reservation saga rolled back partially. Error: ${String(failure.compensationError)}`,
      ).pipe(Effect.andThen(Effect.fail(err)));
    }),
  );
