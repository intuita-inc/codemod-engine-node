import * as S from '@effect/schema/Schema';

const workerThreadMessageSchema = S.union(
	S.struct({
		kind: S.literal('message'),
		message: S.any,
	}),
	S.struct({
		kind: S.literal('idleness'),
	}),
);

export type WorkerThreadMessage = S.To<typeof workerThreadMessageSchema>;

export const decodeWorkerThreadMessage = S.parseSync(workerThreadMessageSchema);
