import * as easingFunctions from './easing-functions';

// CONSTANTS
const DEFAULT_EASING = 'linear';
const DEFAULT_DURATION = 500;
const UPDATE_TIME = 1000 / 60;
const root = typeof window !== 'undefined' ? window : global;

// requestAnimationFrame() shim by Paul Irish (modified for Shifty)
// http://paulirish.com/2011/requestanimationframe-for-smart-animating/
const DEFAULT_SCHEDULE_FUNCTION =
  root.requestAnimationFrame ||
  root.webkitRequestAnimationFrame ||
  root.oRequestAnimationFrame ||
  root.msRequestAnimationFrame ||
  (root.mozCancelRequestAnimationFrame && root.mozRequestAnimationFrame) ||
  setTimeout;

const noop = () => {};

const tweenQueue = [];

const formulas = { ...easingFunctions };

/**
 * Tweens a single property.
 * @param {number} start The value that the tween started from.
 * @param {number} end The value that the tween should end at.
 * @param {Function} easingFunc The easing curve to apply to the tween.
 * @param {number} position The normalized position (between 0.0 and 1.0) to
 * calculate the midpoint of 'start' and 'end' against.
 * @return {number} The tweened value.
 * @private
 */
const tweenProp = (start, end, easingFunc, position) =>
  start + (end - start) * easingFunc(position);

/**
 * Calculates the interpolated tween values of an Object for a given
 * timestamp.
 * @param {number} forPosition The position to compute the state for.
 * @param {Object} currentState Current state properties.
 * @param {Object} originalState: The original state properties the Object is
 * tweening from.
 * @param {Object} targetState: The destination state properties the Object
 * is tweening to.
 * @param {number} duration: The length of the tween in milliseconds.
 * @param {number} timestamp: The UNIX epoch time at which the tween began.
 * @param {Object<string|Function>} easing: This Object's keys must correspond
 * to the keys in targetState.
 * @returns {Object}
 * @private
 */
export const tweenProps = (
  forPosition,
  currentState,
  originalState,
  targetState,
  duration,
  timestamp,
  easing
) => {
  const normalizedPosition =
    forPosition < timestamp ? 0 : (forPosition - timestamp) / duration;

  for (const key in currentState) {
    const easingObjectProp = easing[key];
    const easingFn =
      typeof easingObjectProp === 'function'
        ? easingObjectProp
        : formulas[easingObjectProp];

    currentState[key] = tweenProp(
      originalState[key],
      targetState[key],
      easingFn,
      normalizedPosition
    );
  }

  return currentState;
};

/**
 * Creates a usable easing Object from a string, a function or another easing
 * Object.  If `easing` is an Object, then this function clones it and fills
 * in the missing properties with `"linear"`.
 * @param {Object.<string|Function>} fromTweenParams
 * @param {Object|string|Function} easing
 * @return {Object.<string|Function>}
 * @private
 */
export const composeEasingObject = (
  fromTweenParams,
  easing = DEFAULT_EASING
) => {
  const composedEasing = {};
  let typeofEasing = typeof easing;

  if (typeofEasing === 'string' || typeofEasing === 'function') {
    for (const prop in fromTweenParams) {
      composedEasing[prop] = easing;
    }
  } else {
    for (const prop in fromTweenParams) {
      composedEasing[prop] =
        composedEasing[prop] || easing[prop] || DEFAULT_EASING;
    }
  }

  return composedEasing;
};

const processTween = (tween, now) => {
  const { _currentState, _delay } = tween;
  let { _duration, _step, _targetState, _timestamp } = tween;

  const endTime = _timestamp + _delay + _duration;
  let currentTime = Math.min(now, endTime);
  const hasEnded = currentTime >= endTime;
  const offset = _duration - (endTime - currentTime);

  if (hasEnded) {
    _step(_targetState, tween._attachment, offset);
    tween.stop(true);
  } else {
    tween._applyFilter('beforeTween');

    // If the animation has not yet reached the start point (e.g., there was
    // delay that has not yet completed), just interpolate the starting
    // position of the tween.
    if (currentTime < _timestamp + _delay) {
      currentTime = 1;
      _duration = 1;
      _timestamp = 1;
    } else {
      _timestamp += _delay;
    }

    tweenProps(
      currentTime,
      _currentState,
      tween._originalState,
      _targetState,
      _duration,
      _timestamp,
      tween._easing
    );

    tween._applyFilter('afterTween');
    _step(_currentState, tween._attachment, offset);
  }
};

/* eslint-disable no-unused-vars */
export const processQueue = () => {
  const now = Tweenable.now();

  for (let i = tweenQueue.length; i > 0; i--) {
    const tween = tweenQueue[i - 1];

    if (!tween.isPlaying()) {
      continue;
    }

    processTween(tween, now);
  }
};
/* eslint-enable no-unused-vars */

/**
 * Handles the update logic for one step of a tween.
 * @param {number} [currentTimeOverride] Needed for accurate timestamp in
 * shifty.Tweenable#seek.
 * @private
 */
const timeoutHandler = () => {
  DEFAULT_SCHEDULE_FUNCTION.call(root, timeoutHandler, UPDATE_TIME);

  processQueue();
};

export class Tweenable {
  /**
   * @param {Object} [initialState={}] The values that the initial tween should
   * start at if a `from` value is not provided to {@link
   * shifty.Tweenable#tween} or {@link shifty.Tweenable#setConfig}.
   * @param {shifty.tweenConfig} [config] Configuration object to be passed to
   * {@link shifty.Tweenable#setConfig}.
   * @constructs shifty.Tweenable
   */
  constructor(initialState = {}, config = undefined) {
    this._currentState = initialState;
    this._configured = false;
    this._scheduleFunction = DEFAULT_SCHEDULE_FUNCTION;

    // To prevent unnecessary calls to setConfig do not set default
    // configuration here.  Only set default configuration immediately before
    // tweening if none has been set.
    if (config !== undefined) {
      this.setConfig(config);
    }
  }

  /**
   * Applies a filter to Tweenable instance.
   * @param {string} filterName The name of the filter to apply.
   * @private
   */
  _applyFilter(filterName) {
    const { filters } = Tweenable;
    const { _filterArgs } = this;

    for (const name in filters) {
      const filter = filters[name][filterName];

      if (typeof filter !== 'undefined') {
        filter.apply(this, _filterArgs);
      }
    }
  }

  /**
   * Configure and start a tween.
   * @method shifty.Tweenable#tween
   * @param {shifty.tweenConfig} [config] Gets passed to {@link
   * shifty.Tweenable#setConfig}.
   * @return {external:Promise}
   */
  tween(config = undefined) {
    const { _attachment, _configured, _isTweening } = this;

    if (_isTweening) {
      return this;
    }

    // Only set default config if no configuration has been set previously and
    // none is provided now.
    if (config !== undefined || !_configured) {
      this.setConfig(config);
    }

    this._timestamp = Tweenable.now();
    this._start(this.get(), _attachment);
    return this.resume();
  }

  /**
   * Configure a tween that will start at some point in the future.
   * @method shifty.Tweenable#setConfig
   * @param {shifty.tweenConfig} [config={}]
   * @return {shifty.Tweenable}
   */
  setConfig({
    attachment,
    delay = 0,
    duration = DEFAULT_DURATION,
    easing,
    from,
    promise = Promise,
    start = noop,
    step = noop,
    to,
  }) {
    this._configured = true;

    // Attach something to this Tweenable instance (e.g.: a DOM element, an
    // object, a string, etc.);
    this._attachment = attachment;

    // Init the internal state
    this._pausedAtTime = null;
    this._scheduleId = null;
    this._delay = delay;
    this._start = start;
    this._step = step;
    this._duration = duration;
    this._currentState = { ...(from || this.get()) };
    this._originalState = this.get();
    this._targetState = { ...(to || this.get()) };

    const { _currentState } = this;
    // Ensure that there is always something to tween to.
    this._targetState = { ..._currentState, ...this._targetState };

    this._easing = composeEasingObject(_currentState, easing);

    this._filterArgs = [
      _currentState,
      this._originalState,
      this._targetState,
      this._easing,
    ];

    this._applyFilter('tweenCreated');

    this._promise = new promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });

    // Needed to silence (harmless) logged errors when a .catch handler is not
    // added by downsteam code
    this._promise.catch(noop);

    return this;
  }

  /**
   * @method shifty.Tweenable#get
   * @return {Object} The current state.
   */
  get() {
    return { ...this._currentState };
  }

  /**
   * Set the current state.
   * @method shifty.Tweenable#set
   * @param {Object} state The state to set.
   */
  set(state) {
    this._currentState = state;
  }

  /**
   * Pause a tween.  Paused tweens can be resumed from the point at which they
   * were paused.  This is different from {@link shifty.Tweenable#stop}, as
   * that method causes a tween to start over when it is resumed.
   * @method shifty.Tweenable#pause
   * @return {shifty.Tweenable}
   */
  pause() {
    this._pausedAtTime = Tweenable.now();
    this._isPaused = true;

    return this;
  }

  /**
   * Resume a paused tween.
   * @method shifty.Tweenable#resume
   * @return {external:Promise}
   */
  resume() {
    if (this._isPaused) {
      this._timestamp += Tweenable.now() - this._pausedAtTime;
    }

    this._isPaused = false;
    this._isTweening = true;
    // this.timeoutHandler();
    tweenQueue.unshift(this);

    return this._promise;
  }

  /**
   * Move the state of the animation to a specific point in the tween's
   * timeline.  If the animation is not running, this will cause {@link
   * shifty.stepFunction} handlers to be called.
   * @method shifty.Tweenable#seek
   * @param {millisecond} millisecond The millisecond of the animation to seek
   * to.  This must not be less than `0`.
   * @return {shifty.Tweenable}
   */
  seek(millisecond) {
    millisecond = Math.max(millisecond, 0);
    const currentTime = Tweenable.now();

    if (this._timestamp + millisecond === 0) {
      return this;
    }

    this._timestamp = currentTime - millisecond;

    if (!this.isPlaying()) {
      this._isTweening = true;
      this._isPaused = false;

      // If the animation is not running, call timeoutHandler to make sure that
      // any step handlers are run.
      processTween(this, currentTime);

      this.pause();
    }

    return this;
  }

  /**
   * Stops and cancels a tween.
   * @param {boolean} [gotoEnd] If `false`, the tween just stops at its current
   * state, and the tween promise is not resolved.  If `true`, the tweened
   * object's values are instantly set to the target values, and the promise is
   * resolved.
   * @method shifty.Tweenable#stop
   * @return {shifty.Tweenable}
   */
  stop(gotoEnd = false) {
    const {
      _attachment,
      _currentState,
      _easing,
      _originalState,
      _targetState,
    } = this;

    this._isTweening = false;
    this._isPaused = false;

    const index = tweenQueue.indexOf(this);
    tweenQueue.splice(index, 1);

    if (gotoEnd) {
      this._applyFilter('beforeTween');
      tweenProps(1, _currentState, _originalState, _targetState, 1, 0, _easing);
      this._applyFilter('afterTween');
      this._applyFilter('afterTweenEnd');
      this._resolve(_currentState, _attachment);
    } else {
      this._reject(_currentState, _attachment);
    }

    return this;
  }

  /**
   * Whether or not a tween is running.
   * @method shifty.Tweenable#isPlaying
   * @return {boolean}
   */
  isPlaying() {
    return this._isTweening && !this._isPaused;
  }

  /**
   * @callback scheduleFunction
   * @param {Function} callback
   * @param {number} timeout
   */

  /**
   * Set a custom schedule function.
   *
   * By default,
   * [`requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window.requestAnimationFrame)
   * is used if available, otherwise
   * [`setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/Window.setTimeout)
   * is used.
   * @method shifty.Tweenable#setScheduleFunction
   * @param {scheduleFunction} scheduleFunction The function to be
   * used to schedule the next frame to be rendered.
   */
  setScheduleFunction(scheduleFunction) {
    this._scheduleFunction = scheduleFunction;
  }

  /**
   * `delete` all "own" properties.  Call this when the {@link
   * shifty.Tweenable} instance is no longer needed to free memory.
   * @method shifty.Tweenable#dispose
   */
  dispose() {
    for (const prop in this) {
      delete this[prop];
    }
  }
}

Tweenable.formulas = formulas;

/**
 * The {@link shifty.filter}s available for use.  These filters are
 * automatically applied at tween-time by Shifty.
 * @member shifty.Tweenable.filters
 * @type {Object.<shifty.filter>}
 */
Tweenable.filters = {};

/**
 * @method shifty.Tweenable.now
 * @static
 * @returns {number} The current timestamp.
 */
Tweenable.now = Date.now || (() => +new Date());

/**
 * @method shifty.tween
 * @param {shifty.tweenConfig} [config={}]
 * @description Standalone convenience method that functions identically to
 * {@link shifty.Tweenable#tween}.  You can use this to create tweens without
 * needing to set up a {@link shifty.Tweenable} instance.
 *
 *     import { tween } from 'shifty';
 *
 *     tween({ from: { x: 0 }, to: { x: 10 } }).then(
 *       () => console.log('All done!')
 *     );
 *
 * @returns {external:Promise}
 */
export function tween(config = {}) {
  const tweenable = new Tweenable();
  const promise = tweenable.tween(config);
  promise.tweenable = tweenable;

  return promise;
}

timeoutHandler();
