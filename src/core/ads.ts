/**
 * Rewarded-video entry point. No ad SDK is integrated yet, and per the main design the game never fakes a
 * successful view, so the default provider always answers 'unavailable'. A platform adapter installs itself with
 * setAdProvider(); it must resolve 'rewarded' only after the platform's reward callback, with a receipt id that is
 * unique per view, which the grant functions use to stay idempotent.
 */
export type AdResult = { status: 'rewarded'; receipt: string } | { status: 'unavailable' | 'cancelled' | 'failed' };
export type AdProvider = (placement: string) => Promise<AdResult>;

let provider: AdProvider = async () => ({ status: 'unavailable' });

export function setAdProvider(p: AdProvider) {
  provider = p;
}

export function showRewarded(placement: string): Promise<AdResult> {
  return provider(placement).catch((): AdResult => ({ status: 'failed' }));
}

/** What to tell the player when no reward came back. Nothing is ever taken away on these paths. */
export function adMiss(status: Exclude<AdResult['status'], 'rewarded'>) {
  return status === 'unavailable' ? '广告暂未接入，上线后观看广告即可解锁' : status === 'cancelled' ? '观看未完成，未发放奖励' : '广告加载失败，请稍后再试';
}
