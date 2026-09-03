// `__resetScreenAwakeForTests` is deliberately NOT re-exported here. It was, and
// that put a function which tears down the module's state — including detaching
// the visibilitychange listener the whole feature depends on — one import away
// from any screen. The tests that need it import it from './screenAwake'
// directly, which is the only thing that ever should.
export {
  SCREEN_AWAKE_STORAGE_KEY,
  getScreenAwakeState,
  setScreenAwakePreference,
  startScreenAwake,
  subscribeScreenAwake,
} from './screenAwake';
export type { ScreenAwakeState } from './screenAwake';
export { useScreenAwake } from './useScreenAwake';
export { ScreenAwakeToggle } from './ScreenAwakeToggle';
