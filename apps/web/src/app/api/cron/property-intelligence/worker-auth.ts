export function isWorkerAuthorised(authorization: string | null, queueSecret?: string, cronSecret?: string) {
  const expected = [queueSecret, cronSecret].filter((secret): secret is string => Boolean(secret));
  return expected.some((secret) => authorization === `Bearer ${secret}`);
}
